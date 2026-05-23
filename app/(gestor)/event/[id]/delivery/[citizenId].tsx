/**
 * Wizard de captura de entrega — Sprint 9.2.
 *
 * Pasos:
 *   0. Verify   - confirmar identidad del beneficiario
 *   1. Signature - firma manuscrita en canvas
 *   2. Photo    - foto del documento con la cámara nativa
 *   3. GPS      - ubicación (con fallback "indeterminada" si timeout)
 *   4. Confirm  - revisar evidencia y confirmar
 *   5. Success  - encolar en SQLite y mostrar ID local
 *
 * Bloqueo anti-duplicado: si ya hay un PendingDelivery o el beneficiario
 * está en estado delivered (cualquiera) → no entra al wizard.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import SignatureScreen from 'react-native-signature-canvas';
import { Screen } from '../../../../../components/Screen';
import { Button } from '../../../../../components/Button';
import {
  enqueueDelivery,
  findBeneficiaryByCitizen,
  getCachedEvent,
  isLocalCitizen,
  listDeliveriesByEvent,
  newOfflineId,
  type CachedBeneficiary,
} from '../../../../../lib/offline/db';
import { useAuthStore } from '../../../../../lib/stores/auth-store';
import { sha256OfDataUrl, sha256OfDelivery, shortHash } from '../../../../../lib/crypto/hash';
import { processSyncQueue } from '../../../../../lib/sync/queue';
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
  TOUCH_MIN,
} from '../../../../../lib/theme/tokens';

type Step = 'verify' | 'signature' | 'photo' | 'gps' | 'confirm' | 'success';

interface DeliveryDraft {
  offlineId: string;
  signatureDataUrl: string | null;
  signatureSha256: string | null;
  photoDataUrl: string | null;
  photoSha256: string | null;
  photoSizeKB: number | null;
  gpsLat: number | null;
  gpsLon: number | null;
  gpsAccuracy: number | null;
  gpsStatus: 'ok' | 'indeterminada';
}

function emptyDraft(): DeliveryDraft {
  return {
    offlineId: newOfflineId(),
    signatureDataUrl: null,
    signatureSha256: null,
    photoDataUrl: null,
    photoSha256: null,
    photoSizeKB: null,
    gpsLat: null,
    gpsLon: null,
    gpsAccuracy: null,
    gpsStatus: 'indeterminada',
  };
}

export default function DeliveryWizardScreen() {
  const { id: eventId, citizenId } = useLocalSearchParams<{
    id: string;
    citizenId: string;
  }>();
  const router = useRouter();
  const me = useAuthStore((s) => s.user);

  const [beneficiary, setBeneficiary] =
    useState<CachedBeneficiary | null | undefined>(undefined);
  const [alreadyExists, setAlreadyExists] = useState(false);
  const [step, setStep] = useState<Step>('verify');
  const [draft, setDraft] = useState<DeliveryDraft>(emptyDraft);
  const [submitting, setSubmitting] = useState(false);
  const [composedHash, setComposedHash] = useState<string | null>(null);
  // #1: ¿el ciudadano fue creado offline (id local)? Si sí, el hash compuesto
  // local NO coincide con el del servidor (que usa el citizenId real asignado
  // al sincronizar), así que no lo presentamos como verificable.
  const [citizenIsLocal, setCitizenIsLocal] = useState(false);
  // #2: requisitos de evidencia del evento. Default require-all (mismo default
  // del backend) si el evento no está cacheado por algún motivo.
  const [flags, setFlags] = useState({
    requireSignature: true,
    requirePhoto: true,
    requireGps: true,
  });

  // Cargar beneficiario + flags del evento + check duplicado
  useEffect(() => {
    if (!eventId || !citizenId) return;
    const ev = getCachedEvent(eventId);
    if (ev) {
      setFlags({
        requireSignature: ev.requireSignature,
        requirePhoto: ev.requirePhoto,
        requireGps: ev.requireGps,
      });
    }
    const b = findBeneficiaryByCitizen(eventId, citizenId);
    setBeneficiary(b);
    if (b) {
      const existing = listDeliveriesByEvent(eventId).find(
        (d) => d.citizenId === citizenId,
      );
      if (existing || b.deliveryStatus === 'delivered' || b.hasLocalDelivery) {
        setAlreadyExists(true);
      }
    }
  }, [eventId, citizenId]);

  // #2: secuencia de pasos activos según los flags del evento. 'verify' y
  // 'confirm' siempre están; firma/foto/GPS se incluyen solo si el evento los
  // exige. La navegación es por índice sobre esta lista (no hardcodeada).
  const navSteps = useMemo<Step[]>(
    () => [
      'verify',
      ...(flags.requireSignature ? (['signature'] as Step[]) : []),
      ...(flags.requirePhoto ? (['photo'] as Step[]) : []),
      ...(flags.requireGps ? (['gps'] as Step[]) : []),
      'confirm',
    ],
    [flags],
  );

  const goFrom = (current: Step, dir: 1 | -1): void => {
    const idx = navSteps.indexOf(current);
    const next = navSteps[idx + dir];
    if (next) setStep(next);
  };

  if (beneficiary === undefined) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.cyan} size="large" />
        </View>
      </Screen>
    );
  }

  if (beneficiary === null) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.errTitle}>Beneficiario no encontrado</Text>
          <Text style={styles.errBody}>
            Verifica que descargaste la lista del evento.
          </Text>
          <View style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}>
            <Button label="Volver" variant="secondary" onPress={() => router.back()} />
          </View>
        </View>
      </Screen>
    );
  }

  if (alreadyExists && step !== 'success') {
    return (
      <Screen>
        <View style={styles.center}>
          <View style={styles.alreadyCard}>
            <Text style={styles.alreadyTitle}>✓ Entrega ya registrada</Text>
            <Text style={styles.alreadyName}>{beneficiary.fullName}</Text>
            <Text style={styles.alreadyDoc}>
              {beneficiary.documentType} {beneficiary.documentNumber}
            </Text>
            <Text style={styles.alreadyHelp}>
              No se puede entregar dos veces a la misma persona. Si la entrega
              fue incorrecta, contacta al coordinador para anularla.
            </Text>
          </View>
          <View style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}>
            <Button label="Volver a la lista" onPress={() => router.back()} />
          </View>
        </View>
      </Screen>
    );
  }

  // #2: el total y el índice salen de la secuencia activa (no fijos en 5).
  const totalSteps = navSteps.length;
  const stepIndex =
    step === 'success' ? totalSteps : Math.max(navSteps.indexOf(step), 0);

  const submit = async () => {
    if (!me?.id || !eventId) return;
    // #2: exigir solo la evidencia que el evento requiere (alineado con el
    // enforcement server-side en deliveries.create).
    if (flags.requireSignature && (!draft.signatureDataUrl || !draft.signatureSha256)) {
      return;
    }
    if (flags.requirePhoto && (!draft.photoDataUrl || !draft.photoSha256)) {
      return;
    }
    setSubmitting(true);
    try {
      const capturedAt = new Date().toISOString();
      // Hash con '' para evidencia ausente — idéntico al composeHash del
      // backend (que usa `?? ''`), así el hash compuesto coincide.
      const hash = await sha256OfDelivery({
        citizenId: beneficiary.citizenId,
        eventId,
        capturedAt,
        signatureSha256: draft.signatureSha256 ?? '',
        photoSha256: draft.photoSha256 ?? '',
      });
      setComposedHash(hash);
      setCitizenIsLocal(isLocalCitizen(beneficiary.citizenId));

      enqueueDelivery({
        id: draft.offlineId,
        eventId,
        citizenId: beneficiary.citizenId,
        gestorId: me.id,
        signatureDataUrl: draft.signatureDataUrl,
        signatureSha256: draft.signatureSha256,
        photoDataUrl: draft.photoDataUrl,
        photoSha256: draft.photoSha256,
        photoSizeKB: draft.photoSizeKB,
        gpsLat: draft.gpsLat,
        gpsLon: draft.gpsLon,
        gpsAccuracy: draft.gpsAccuracy,
        gpsStatus: draft.gpsStatus,
        customFormData: null,
        syncStatus: 'pending',
        retryCount: 0,
        nextAttemptAt: null,
        lastAttemptAt: null,
        lastError: null,
        capturedAt,
        syncedAt: null,
        serverId: null,
      });

      // Sprint 9.10: auto-sync online. Disparamos el upload sin await
      // para que la UI vaya a 'success' inmediatamente. Si hay red, el
      // delivery sube de una; si no, queda pending y se subirá cuando el
      // operador toque Sincronizar (o en un próximo arranque online).
      void processSyncQueue();

      setStep('success');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen padding="none">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        {step !== 'success' && (
          <View style={styles.header}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.back, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.backText}>← Cancelar</Text>
            </Pressable>
            <View style={styles.stepBar}>
              {Array.from({ length: totalSteps }, (_, i) => (
                <View
                  key={i}
                  style={[
                    styles.stepDot,
                    {
                      backgroundColor:
                        i < stepIndex
                          ? colors.success
                          : i === stepIndex
                            ? colors.cyan
                            : colors.bgInput,
                    },
                  ]}
                />
              ))}
            </View>
            <Text style={styles.stepTitle}>
              Paso {stepIndex + 1} de {totalSteps}
            </Text>
          </View>
        )}

        {step === 'verify' && (
          <VerifyStep
            beneficiary={beneficiary}
            onContinue={() => goFrom('verify', 1)}
          />
        )}

        {step === 'signature' && (
          <SignatureStep
            onBack={() => goFrom('signature', -1)}
            onContinue={async (dataUrl) => {
              const hash = await sha256OfDataUrl(dataUrl);
              setDraft((d) => ({
                ...d,
                signatureDataUrl: dataUrl,
                signatureSha256: hash,
              }));
              goFrom('signature', 1);
            }}
          />
        )}

        {step === 'photo' && (
          <PhotoStep
            onBack={() => goFrom('photo', -1)}
            onContinue={async (dataUrl, sizeKB) => {
              const hash = await sha256OfDataUrl(dataUrl);
              setDraft((d) => ({
                ...d,
                photoDataUrl: dataUrl,
                photoSha256: hash,
                photoSizeKB: sizeKB,
              }));
              goFrom('photo', 1);
            }}
          />
        )}

        {step === 'gps' && (
          <GpsStep
            onBack={() => goFrom('gps', -1)}
            onContinue={(coords) => {
              setDraft((d) => ({
                ...d,
                gpsLat: coords?.lat ?? null,
                gpsLon: coords?.lon ?? null,
                gpsAccuracy: coords?.accuracy ?? null,
                gpsStatus: coords ? 'ok' : 'indeterminada',
              }));
              goFrom('gps', 1);
            }}
          />
        )}

        {step === 'confirm' && (
          <ConfirmStep
            beneficiary={beneficiary}
            draft={draft}
            requireGps={flags.requireGps}
            submitting={submitting}
            onBack={() => goFrom('confirm', -1)}
            onSubmit={() => void submit()}
          />
        )}

        {step === 'success' && composedHash && (
          <SuccessStep
            beneficiary={beneficiary}
            offlineId={draft.offlineId}
            composedHash={composedHash}
            citizenIsLocal={citizenIsLocal}
            onBackToList={() => {
              // Pop el wizard del stack en vez de hacer replace.
              // replace dejaba un /beneficiaries duplicado por cada captura;
              // tras 10 entregas el operador tenía que tocar "back" 10 veces.
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace(`/event/${eventId}/beneficiaries` as never);
              }
            }}
            onCaptureNext={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace(`/event/${eventId}/beneficiaries` as never);
              }
            }}
          />
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

/* ─────────────────────────── Step 1: Verify ─────────────────────────── */

function VerifyStep({
  beneficiary,
  onContinue,
}: {
  beneficiary: CachedBeneficiary;
  onContinue: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.stepBody}>
      <Text style={styles.h1}>Verificar identidad</Text>
      <Text style={styles.h2}>
        Antes de capturar, confirma con el beneficiario que es la persona correcta.
      </Text>

      <View style={styles.idCard}>
        <View
          style={[styles.idAvatar, { backgroundColor: colors.cyanSoft }]}
        >
          <Text style={styles.idAvatarText}>{initials(beneficiary.fullName)}</Text>
        </View>
        <Text style={styles.idName}>{beneficiary.fullName}</Text>
        <Text style={styles.idDoc}>
          {beneficiary.documentType} {beneficiary.documentNumber}
        </Text>
        {beneficiary.sectorName && (
          <Text style={styles.idSector}>📍 {beneficiary.sectorName}</Text>
        )}
      </View>

      <View style={styles.checklistCard}>
        <Text style={styles.checklistTitle}>Checklist</Text>
        <Text style={styles.checklistItem}>✓ Confirma documento físico</Text>
        <Text style={styles.checklistItem}>✓ Confirma nombre completo</Text>
        <Text style={styles.checklistItem}>✓ Persona acepta entrega del beneficio</Text>
      </View>

      <Button label="Continuar a firma" onPress={onContinue} />
    </ScrollView>
  );
}

/* ─────────────────────────── Step 2: Signature ─────────────────────────── */

function SignatureStep({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: (dataUrl: string) => void;
}) {
  // signature-canvas tipa el ref más rico (changePenColor, draw, etc) pero
  // solo usamos readSignature/clearSignature. Cast a any para no instalar
  // los types extras que no necesitamos.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sigRef = useRef<any>(null);
  const [hasInk, setHasInk] = useState(false);

  return (
    <View style={styles.stepBody}>
      <Text style={styles.h1}>Firma manuscrita</Text>
      <Text style={styles.h2}>
        El beneficiario firma con el dedo dentro del recuadro blanco.
      </Text>

      <View style={styles.signatureBox}>
        <SignatureScreen
          ref={sigRef}
          onOK={(sig) => onContinue(sig)}
          onEmpty={() => {
            // empty signature
          }}
          onBegin={() => setHasInk(true)}
          onClear={() => setHasInk(false)}
          descriptionText=""
          clearText="Limpiar"
          confirmText="OK"
          webStyle={`
            .m-signature-pad { box-shadow: none; border: none; margin: 0; }
            .m-signature-pad--body { border: none; }
            .m-signature-pad--footer { display: none; }
            body, html { background-color: white; height: 100%; }
          `}
          backgroundColor="white"
          penColor="#0D1B2A"
          minWidth={2}
          maxWidth={4}
        />
      </View>

      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          <Button
            label="Limpiar"
            variant="ghost"
            onPress={() => {
              sigRef.current?.clearSignature();
              setHasInk(false);
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={hasInk ? 'Continuar' : 'Firma vacía'}
            disabled={!hasInk}
            onPress={() => {
              sigRef.current?.readSignature();
            }}
          />
        </View>
      </View>

      <View style={{ marginTop: spacing.sm }}>
        <Button label="← Volver" variant="ghost" onPress={onBack} />
      </View>
    </View>
  );
}

/* ─────────────────────────── Step 3: Photo ─────────────────────────── */

function PhotoStep({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: (dataUrl: string, sizeKB: number) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    dataUrl: string;
    sizeKB: number;
  } | null>(null);

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.cyan} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.stepBody}>
        <Text style={styles.h1}>Permiso de cámara</Text>
        <Text style={styles.h2}>
          SICE necesita acceso a la cámara para tomar la foto del documento.
        </Text>
        <Button label="Conceder permiso" onPress={() => void requestPermission()} />
        <View style={{ marginTop: spacing.sm }}>
          <Button label="← Volver" variant="ghost" onPress={onBack} />
        </View>
      </View>
    );
  }

  const takePicture = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    setPhotoError(null);
    try {
      const pic = await cameraRef.current.takePictureAsync({
        quality: 0.6,
        base64: true,
        skipProcessing: false,
      });
      // #3: la cámara puede devolver sin base64 (foto cancelada / buffer
      // vacío) sin lanzar — lo tratamos como error recuperable, no en silencio.
      if (pic?.base64) {
        const dataUrl = `data:image/jpeg;base64,${pic.base64}`;
        const sizeKB = Math.round((pic.base64.length * 3) / 4 / 1024);
        setPreview({ dataUrl, sizeKB });
      } else {
        setPhotoError('No se capturó la imagen. Intenta de nuevo.');
      }
    } catch (e) {
      // #3: antes el catch no existía y un fallo de cámara (buffer ocupado,
      // permiso revocado en caliente, OOM) se tragaba en silencio dejando al
      // operador sin foto y sin saber por qué. Ahora mostramos el error y el
      // botón permite reintentar.
      setPhotoError(
        e instanceof Error
          ? `No se pudo tomar la foto: ${e.message}`
          : 'No se pudo tomar la foto. Intenta de nuevo.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (preview) {
    return (
      <View style={styles.stepBody}>
        <Text style={styles.h1}>Foto del documento</Text>
        <Text style={styles.h2}>
          Verifica que se lea claramente. Si está borrosa, vuelve a tomarla.
        </Text>

        <View style={styles.previewBox}>
          <Image source={{ uri: preview.dataUrl }} style={styles.previewImg} />
        </View>
        <Text style={styles.previewMeta}>{preview.sizeKB} KB</Text>

        <Button
          label="Continuar"
          onPress={() => onContinue(preview.dataUrl, preview.sizeKB)}
        />
        <View style={{ marginTop: spacing.sm }}>
          <Button
            label="Volver a tomar"
            variant="secondary"
            onPress={() => setPreview(null)}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.stepBody}>
      <Text style={styles.h1}>Foto del documento</Text>
      <Text style={styles.h2}>
        Encuadra el documento y toca el botón de captura.
      </Text>

      <View style={styles.cameraBox}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      </View>

      {photoError && (
        <View style={styles.photoErrorBox}>
          <Text style={styles.photoErrorText}>{photoError}</Text>
          <Text style={styles.photoErrorHint}>
            Limpia el lente y vuelve a tocar “Tomar foto”.
          </Text>
        </View>
      )}

      <Button
        label={busy ? 'Capturando…' : photoError ? '📸 Reintentar foto' : '📸 Tomar foto'}
        onPress={() => void takePicture()}
        loading={busy}
      />
      <View style={{ marginTop: spacing.sm }}>
        <Button label="← Volver" variant="ghost" onPress={onBack} />
      </View>
    </View>
  );
}

/* ─────────────────────────── Step 4: GPS ─────────────────────────── */

function GpsStep({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: (
    coords: { lat: number; lon: number; accuracy: number | null } | null,
  ) => void;
}) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'asking' }
    | { kind: 'denied' }
    | { kind: 'fetching' }
    | { kind: 'ok'; lat: number; lon: number; accuracy: number | null }
    | { kind: 'error'; msg: string }
  >({ kind: 'idle' });

  const fetchLocation = async () => {
    setState({ kind: 'asking' });
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      setState({ kind: 'denied' });
      return;
    }
    setState({ kind: 'fetching' });
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setState({
        kind: 'ok',
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        // #8: NO forzar 0 cuando es desconocida (mostraría "±0m perfecto").
        // null = "precisión desconocida"; el backend la acepta nullable.
        accuracy: pos.coords.accuracy ?? null,
      });
    } catch (e) {
      setState({
        kind: 'error',
        msg: e instanceof Error ? e.message : 'Error desconocido',
      });
    }
  };

  useEffect(() => {
    void fetchLocation();
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.stepBody}>
      <Text style={styles.h1}>Ubicación GPS</Text>
      <Text style={styles.h2}>
        SICE captura tu ubicación al momento de la entrega como evidencia
        de campo.
      </Text>

      <View style={styles.gpsCard}>
        {state.kind === 'asking' && (
          <Text style={styles.gpsState}>Solicitando permiso…</Text>
        )}
        {state.kind === 'fetching' && (
          <>
            <ActivityIndicator color={colors.cyan} size="large" />
            <Text style={styles.gpsState}>Buscando satélites…</Text>
          </>
        )}
        {state.kind === 'ok' && (
          <>
            <Text style={[styles.gpsState, { color: colors.success }]}>
              ✓ Ubicación capturada
            </Text>
            <Text style={styles.gpsCoord}>
              {state.lat.toFixed(6)}, {state.lon.toFixed(6)}
            </Text>
            <Text style={styles.gpsAcc}>
              {state.accuracy != null
                ? `Precisión ±${Math.round(state.accuracy)}m`
                : 'Precisión desconocida'}
            </Text>
          </>
        )}
        {state.kind === 'denied' && (
          <Text style={[styles.gpsState, { color: colors.warning }]}>
            Permiso denegado. La entrega quedará marcada como
            ubicación-indeterminada.
          </Text>
        )}
        {state.kind === 'error' && (
          <Text style={[styles.gpsState, { color: colors.warning }]}>
            No se pudo obtener GPS: {state.msg}
          </Text>
        )}
      </View>

      {state.kind === 'ok' ? (
        <Button
          label="Continuar"
          onPress={() =>
            onContinue({
              lat: state.lat,
              lon: state.lon,
              accuracy: state.accuracy,
            })
          }
        />
      ) : state.kind === 'denied' || state.kind === 'error' ? (
        <>
          <Button
            label="Continuar sin GPS"
            variant="secondary"
            onPress={() => onContinue(null)}
          />
          <View style={{ marginTop: spacing.sm }}>
            <Button
              label="Reintentar GPS"
              variant="ghost"
              onPress={() => void fetchLocation()}
            />
          </View>
        </>
      ) : null}

      <View style={{ marginTop: spacing.sm }}>
        <Button label="← Volver" variant="ghost" onPress={onBack} />
      </View>
    </ScrollView>
  );
}

/* ─────────────────────────── Step 5: Confirm ─────────────────────────── */

function ConfirmStep({
  beneficiary,
  draft,
  requireGps,
  submitting,
  onBack,
  onSubmit,
}: {
  beneficiary: CachedBeneficiary;
  draft: DeliveryDraft;
  requireGps: boolean;
  submitting: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.stepBody}>
      <Text style={styles.h1}>Confirmar entrega</Text>
      <Text style={styles.h2}>
        Revisa la evidencia antes de confirmar. Una vez confirmada, no se
        puede modificar.
      </Text>

      <View style={styles.confirmCard}>
        <Text style={styles.confirmLabel}>Beneficiario</Text>
        <Text style={styles.confirmValue}>{beneficiary.fullName}</Text>
        <Text style={styles.confirmDoc}>
          {beneficiary.documentType} {beneficiary.documentNumber}
        </Text>

        {/* #2: secciones de evidencia condicionales — si el evento no exige
            firma/foto, el paso se omite y no mostramos una sección vacía. */}
        {draft.signatureDataUrl && (
          <>
            <View style={styles.divider} />
            <Text style={styles.confirmLabel}>Firma</Text>
            <View style={styles.confirmSig}>
              <Image
                source={{ uri: draft.signatureDataUrl }}
                style={styles.confirmSigImg}
                resizeMode="contain"
              />
            </View>
            {draft.signatureSha256 && (
              <Text style={styles.hashText}>
                SHA-256 {shortHash(draft.signatureSha256)}
              </Text>
            )}
          </>
        )}

        {draft.photoDataUrl && (
          <>
            <View style={styles.divider} />
            <Text style={styles.confirmLabel}>Foto del documento</Text>
            <Image
              source={{ uri: draft.photoDataUrl }}
              style={styles.confirmPhoto}
              resizeMode="cover"
            />
            {draft.photoSha256 && (
              <Text style={styles.hashText}>
                SHA-256 {shortHash(draft.photoSha256)} · {draft.photoSizeKB} KB
              </Text>
            )}
          </>
        )}

        <View style={styles.divider} />
        <Text style={styles.confirmLabel}>GPS</Text>
        <Text style={styles.confirmValue}>
          {draft.gpsStatus === 'ok' && draft.gpsLat != null
            ? `${draft.gpsLat.toFixed(6)}, ${draft.gpsLon?.toFixed(6)}`
            : requireGps
              ? 'Indeterminada (sin permiso o señal débil)'
              : 'No requerido para este evento'}
        </Text>
        {draft.gpsStatus === 'ok' && (
          <Text style={styles.confirmDoc}>
            {draft.gpsAccuracy != null
              ? `Precisión ±${Math.round(draft.gpsAccuracy)}m`
              : 'Precisión desconocida'}
          </Text>
        )}
      </View>

      <Button
        label={submitting ? 'Guardando…' : 'Confirmar y registrar'}
        onPress={onSubmit}
        loading={submitting}
        disabled={submitting}
      />
      <View style={{ marginTop: spacing.sm }}>
        <Button
          label="← Volver"
          variant="ghost"
          onPress={onBack}
          disabled={submitting}
        />
      </View>
    </ScrollView>
  );
}

/* ─────────────────────────── Success ─────────────────────────── */

function SuccessStep({
  beneficiary,
  offlineId,
  composedHash,
  citizenIsLocal,
  onBackToList,
  onCaptureNext,
}: {
  beneficiary: CachedBeneficiary;
  offlineId: string;
  composedHash: string;
  citizenIsLocal: boolean;
  onBackToList: () => void;
  onCaptureNext: () => void;
}) {
  return (
    <View style={styles.successWrap}>
      <View style={styles.successIcon}>
        <Text style={styles.successCheck}>✓</Text>
      </View>
      <Text style={styles.successTitle}>Entrega registrada</Text>
      <Text style={styles.successName}>{beneficiary.fullName}</Text>
      <Text style={styles.successDoc}>
        {beneficiary.documentType} {beneficiary.documentNumber}
      </Text>

      <View style={styles.successCard}>
        <Text style={styles.successLabel}>ID local</Text>
        <Text style={styles.successMono}>
          SICE-{offlineId.slice(0, 8).toUpperCase()}
        </Text>
        <View style={styles.divider} />
        <Text style={styles.successLabel}>Hash compuesto</Text>
        {citizenIsLocal ? (
          <Text style={styles.successPendingHash}>
            Se generará al sincronizar (el ID definitivo del ciudadano se
            asigna en el servidor).
          </Text>
        ) : (
          <Text style={styles.successMono}>{shortHash(composedHash, 8, 6)}</Text>
        )}
        <View style={styles.divider} />
        <Text style={styles.successLabel}>Estado</Text>
        <Text style={[styles.successMono, { color: colors.warning }]}>
          ⏳ Pendiente de sincronizar
        </Text>
      </View>

      <View style={{ alignSelf: 'stretch', marginTop: spacing.lg }}>
        <Button label="📸 Siguiente beneficiario" onPress={onCaptureNext} />
        <View style={{ marginTop: spacing.sm }}>
          <Button label="Volver a la lista" variant="secondary" onPress={onBackToList} />
        </View>
      </View>
    </View>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  errTitle: {
    color: colors.error,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
  },
  errBody: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  alreadyCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.success,
    alignItems: 'center',
  },
  alreadyTitle: {
    color: colors.success,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
  },
  alreadyName: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    marginTop: spacing.sm,
  },
  alreadyDoc: {
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    fontVariant: ['tabular-nums'],
  },
  alreadyHelp: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 20,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: {
    paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
  },
  backText: {
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
  },
  stepBar: {
    flexDirection: 'row',
    gap: 4,
    marginTop: spacing.sm,
  },
  stepDot: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  stepTitle: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xs,
  },
  stepBody: {
    padding: spacing.lg,
    flexGrow: 1,
  },
  h1: {
    color: colors.textPrimary,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.extrabold,
  },
  h2: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  idCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.cyan,
    marginBottom: spacing.md,
  },
  idAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  idAvatarText: {
    color: colors.cyan,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.extrabold,
  },
  idName: {
    color: colors.textPrimary,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
    textAlign: 'center',
  },
  idDoc: {
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  idSector: {
    color: colors.cyan,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    marginTop: spacing.sm,
  },
  checklistCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  checklistTitle: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  checklistItem: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    paddingVertical: 2,
  },
  signatureBox: {
    height: 280,
    backgroundColor: 'white',
    borderRadius: radii.md,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  row2: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cameraBox: {
    height: 380,
    borderRadius: radii.md,
    overflow: 'hidden',
    marginBottom: spacing.md,
    backgroundColor: 'black',
  },
  camera: {
    flex: 1,
  },
  previewBox: {
    height: 380,
    borderRadius: radii.md,
    overflow: 'hidden',
    marginBottom: spacing.sm,
    backgroundColor: 'black',
  },
  previewImg: {
    flex: 1,
    width: '100%',
  },
  previewMeta: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  photoErrorBox: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.error,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  photoErrorText: {
    color: colors.error,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    textAlign: 'center',
  },
  photoErrorHint: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  gpsCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    minHeight: 140,
    justifyContent: 'center',
    gap: spacing.sm,
  },
  gpsState: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    textAlign: 'center',
  },
  gpsCoord: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontVariant: ['tabular-nums'],
  },
  gpsAcc: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
  },
  confirmCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  confirmLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  confirmValue: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
  },
  confirmDoc: {
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    fontVariant: ['tabular-nums'],
  },
  confirmSig: {
    height: 100,
    backgroundColor: 'white',
    borderRadius: radii.sm,
    marginVertical: spacing.sm,
  },
  confirmSigImg: {
    flex: 1,
  },
  confirmPhoto: {
    height: 200,
    borderRadius: radii.sm,
    marginTop: spacing.sm,
  },
  hashText: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    fontVariant: ['tabular-nums'],
    marginTop: spacing.xs,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  successWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.successBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  successCheck: {
    color: colors.success,
    fontSize: 40,
    fontWeight: fontWeights.extrabold,
  },
  successTitle: {
    color: colors.success,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.extrabold,
    textAlign: 'center',
  },
  successName: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  successDoc: {
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    fontVariant: ['tabular-nums'],
  },
  successCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'stretch',
    marginTop: spacing.lg,
  },
  successLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  successMono: {
    color: colors.cyan,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.bold,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  successPendingHash: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    marginTop: 4,
    lineHeight: 16,
  },
});
