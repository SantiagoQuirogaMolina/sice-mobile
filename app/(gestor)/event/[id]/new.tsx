/**
 * Sprint 9.9 — Nuevo registro Tipo B (ad-hoc).
 *
 * Pantalla a la que llega el operador desde el detalle de un evento Tipo B
 * cuando va a registrar a un participante nuevo (sin lista pre-cargada).
 *
 * Diferencias con exception.tsx (Tipo A):
 *   - source = 'ad_hoc' (no 'exception')
 *   - Sin justificación obligatoria
 *   - Sin gate de event.allowExceptions
 *   - Sector opcional
 *
 * Crea atómicamente igual que excepciones:
 *   - pending_citizen + pending_event_beneficiary + cached_beneficiary
 * y navega al wizard de captura.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../../../../components/Screen';
import { Button } from '../../../../components/Button';
import { Input } from '../../../../components/Input';
import {
  eventsService,
  type EventSummary,
  type SectorInfo,
} from '../../../../lib/api/services/events.service';
import {
  findBeneficiaryByDoc,
  registerExceptionOffline,
  type DocumentType,
} from '../../../../lib/offline/db';
import { useAuthStore } from '../../../../lib/stores/auth-store';
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
  TOUCH_MIN,
} from '../../../../lib/theme/tokens';

const DOCUMENT_TYPES: DocumentType[] = ['CC', 'TI', 'CE', 'PA', 'PPT'];

export default function NewRegistrationForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [event, setEvent] = useState<EventSummary | null>(null);
  const [sectors, setSectors] = useState<SectorInfo[]>([]);
  const [loadingEvent, setLoadingEvent] = useState(true);
  const [loadSectorsError, setLoadSectorsError] = useState<string | null>(null);

  const [documentType, setDocumentType] = useState<DocumentType>('CC');
  const [documentNumber, setDocumentNumber] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [justification, setJustification] = useState('');
  const [sectorId, setSectorId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sectores donde el operador está asignado. El backend exige el sectorId
  // en POST /events/:id/beneficiaries para gestor/asistente — sin él tira
  // 400 SECTOR_REQUIRED_FOR_OPERATOR y la excepción queda blocked.
  const myAssignedSectors = useMemo(() => {
    if (!user?.id) return [];
    return sectors.filter((s) => s.gestorIds.includes(user.id));
  }, [sectors, user?.id]);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const [ev, sects] = await Promise.allSettled([
          eventsService.getById(id),
          eventsService.listSectors(id),
        ]);
        if (ev.status === 'fulfilled') setEvent(ev.value);
        if (sects.status === 'fulfilled') {
          setSectors(sects.value);
        } else {
          setLoadSectorsError(
            sects.reason instanceof Error
              ? sects.reason.message
              : 'No se pudo cargar la lista de sectores',
          );
        }
      } finally {
        setLoadingEvent(false);
      }
    })();
  }, [id]);

  // Pre-seleccionar el sector si el operador solo tiene UNO asignado.
  // Si tiene varios → debe elegir manualmente.
  useEffect(() => {
    if (myAssignedSectors.length === 1 && !sectorId) {
      setSectorId(myAssignedSectors[0].id);
    }
  }, [myAssignedSectors, sectorId]);

  if (loadingEvent) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.cyan} size="large" />
        </View>
      </Screen>
    );
  }

  if (!id || !event) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.errorText}>Evento no encontrado</Text>
          <Button label="Volver" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  // Tipo B: NO se gate por allowExceptions ni se requiere sector.
  const trimmedDoc = documentNumber.trim();
  const trimmedFirst = firstName.trim();
  const trimmedLast = lastName.trim();

  const justificationError = null;

  const formValid =
    trimmedDoc.length >= 4 &&
    trimmedDoc.length <= 20 &&
    /^[A-Za-z0-9]+$/.test(trimmedDoc) &&
    trimmedFirst.length >= 1 &&
    trimmedLast.length >= 1;

  const onSubmit = () => {
    if (!user?.tenantId) {
      setError('Tu sesión no tiene tenant. Cierra sesión e ingresa de nuevo.');
      return;
    }
    if (!formValid) return;

    // Anti-duplicado local: si ya hay un beneficiario con ese doc en este
    // evento, ofrecemos navegar al delivery existente en vez de crear otro.
    const existing = findBeneficiaryByDoc(id, trimmedDoc);
    if (existing) {
      setError(
        `Ya existe ${existing.fullName} con documento ${existing.documentNumber} en la lista. Usa la búsqueda para entregarle.`,
      );
      return;
    }

    // Tipo B: sector es opcional. Si lo seleccionó, lo usamos; si no, null.
    const sectorMeta = sectorId
      ? myAssignedSectors.find((s) => s.id === sectorId) ?? null
      : null;

    setSubmitting(true);
    setError(null);
    try {
      const { citizenLocalId } = registerExceptionOffline({
        tenantId: user.tenantId,
        eventId: id,
        documentType,
        documentNumber: trimmedDoc,
        firstName: trimmedFirst,
        lastName: trimmedLast,
        phone: phone.trim() || undefined,
        // ad_hoc: sin justificación obligatoria
        justification: '',
        source: 'ad_hoc',
        sectorId: sectorId ?? null,
        sectorName: sectorMeta?.name ?? null,
        zona: sectorMeta?.zona ?? null,
      });
      router.replace(
        `/event/${id}/delivery/${citizenLocalId}?fromNew=1` as never,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar');
      setSubmitting(false);
    }
  };

  return (
    <Screen padding="none">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.back, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.backText}>← Cancelar</Text>
          </Pressable>

          <Text style={styles.title}>Nuevo registro</Text>
          <Text style={styles.subtitle}>
            {event.name}
          </Text>

          <View style={styles.infoBanner}>
            <Text style={styles.infoBannerTitle}>Registro de asistencia</Text>
            <Text style={styles.infoBannerBody}>
              Capturá los datos básicos del participante. Se guarda local
              inmediatamente y se sincroniza cuando vuelva la red.
            </Text>
          </View>

          {/* Sector — el backend lo exige para gestor/asistente */}
          <Text style={styles.sectionLabel}>Sector</Text>
          {myAssignedSectors.length === 1 ? (
            <View style={styles.sectorAuto}>
              <Text style={styles.sectorAutoLabel}>Asignado a tu sector</Text>
              <Text style={styles.sectorAutoName}>
                {myAssignedSectors[0].name}
              </Text>
              <Text style={styles.sectorAutoZona}>
                {myAssignedSectors[0].zona === 'urbana' ? '🏙 Urbana' : '🌾 Rural'}
              </Text>
            </View>
          ) : (
            <View style={styles.sectorList}>
              {myAssignedSectors.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => setSectorId(s.id)}
                  style={({ pressed }) => [
                    styles.sectorOption,
                    sectorId === s.id && styles.sectorOptionActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.sectorOptionName,
                        sectorId === s.id && { color: colors.cyan },
                      ]}
                    >
                      {s.name}
                    </Text>
                    <Text style={styles.sectorOptionMeta}>
                      {s.zona === 'urbana' ? '🏙 Urbana' : '🌾 Rural'} ·{' '}
                      {s.beneficiaryCount} pre-cargados
                    </Text>
                  </View>
                  {sectorId === s.id && (
                    <Text style={styles.sectorOptionCheck}>✓</Text>
                  )}
                </Pressable>
              ))}
            </View>
          )}

          {/* Documento */}
          <Text style={styles.sectionLabel}>Documento</Text>
          <View style={styles.docRow}>
            <View style={styles.docTypeWrap}>
              <Text style={styles.miniLabel}>Tipo</Text>
              <View style={styles.chipRow}>
                {DOCUMENT_TYPES.map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => setDocumentType(t)}
                    style={({ pressed }) => [
                      styles.chip,
                      documentType === t && styles.chipActive,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        documentType === t && styles.chipTextActive,
                      ]}
                    >
                      {t}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

          <Input
            label="Número de documento"
            value={documentNumber}
            onChangeText={(v) => setDocumentNumber(v.replace(/[\s.\-_]/g, ''))}
            keyboardType={documentType === 'PA' || documentType === 'PPT' ? 'default' : 'number-pad'}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="Ej. 1098765432"
            maxLength={20}
          />

          {/* Identidad */}
          <Text style={styles.sectionLabel}>Identidad</Text>
          <Input
            label="Nombres"
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Ej. Ana María"
            autoCapitalize="words"
            maxLength={80}
          />
          <Input
            label="Apellidos"
            value={lastName}
            onChangeText={setLastName}
            placeholder="Ej. Rodríguez Pérez"
            autoCapitalize="words"
            maxLength={80}
          />
          <Input
            label="Teléfono (opcional)"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="+57 311 222 3344"
            maxLength={40}
          />

          {/* Tipo B (ad-hoc): sin justificación */}

          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{error}</Text>
            </View>
          )}

          <View style={{ marginTop: spacing.lg }}>
            <Button
              label="Guardar y capturar firma"
              variant="primary"
              onPress={onSubmit}
              disabled={!formValid || submitting}
              loading={submitting}
            />
            <View style={{ height: spacing.sm }} />
            <Button
              label="Cancelar"
              variant="ghost"
              onPress={() => router.back()}
            />
          </View>

          <Text style={styles.foot}>
            La excepción se sube al volver la red. Si el documento ya existe en
            otro evento, el sistema lo enlaza sin duplicar.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  back: {
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  backText: {
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.extrabold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  infoBanner: {
    backgroundColor: colors.cyanSoft,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.cyan,
  },
  infoBannerTitle: {
    color: colors.cyan,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoBannerBody: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  miniLabel: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  docRow: {
    marginBottom: spacing.md,
  },
  docTypeWrap: {
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minWidth: 56,
    height: TOUCH_MIN,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgInput,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.bold,
  },
  chipTextActive: {
    color: colors.navyDark,
  },
  textarea: {
    height: 100,
    paddingTop: spacing.sm,
    textAlignVertical: 'top',
  },
  errorBanner: {
    marginTop: spacing.md,
    backgroundColor: colors.errorBg,
    borderRadius: radii.md,
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
  },
  errorBannerText: {
    color: colors.error,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
  },
  foot: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    marginTop: spacing.lg,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorText: {
    color: colors.error,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
  },
  errorTitle: {
    color: colors.warning,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.extrabold,
    textAlign: 'center',
  },
  errorBody: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  sectorAuto: {
    backgroundColor: colors.cyanSoft,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.cyan,
    marginBottom: spacing.md,
  },
  sectorAutoLabel: {
    color: colors.cyan,
    fontSize: 10,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectorAutoName: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.bold,
    marginTop: 2,
  },
  sectorAutoZona: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    marginTop: 2,
  },
  sectorList: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectorOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgInput,
    gap: spacing.sm,
  },
  sectorOptionActive: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanSoft,
  },
  sectorOptionName: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
  },
  sectorOptionMeta: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    marginTop: 2,
  },
  sectorOptionCheck: {
    color: colors.cyan,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.extrabold,
  },
});
