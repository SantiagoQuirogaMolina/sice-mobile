/**
 * Sprint 9.4 — Registrar excepción offline.
 *
 * Pantalla a la que llega el operador desde el detalle del evento cuando
 * el ciudadano que está atendiendo no aparece en la lista pre-cargada y
 * el evento permite excepciones (allowExceptions=true).
 *
 * Crea atómicamente:
 *   - pending_citizen   (POST /citizens al sincronizar)
 *   - pending_event_beneficiary (POST /events/:id/beneficiaries al sincronizar)
 *   - cached_beneficiary (visible en la lista del operador inmediatamente)
 *
 * Post: navega al wizard de captura con citizenId = pending_citizen.localId.
 * Cuando vuelva la red, queue.ts hace upload en orden:
 *   citizen → eb → delivery
 */

import { useEffect, useState } from 'react';
import {
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
const MIN_JUSTIFICATION = 20;
const MAX_JUSTIFICATION = 500;

export default function ExceptionForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [event, setEvent] = useState<EventSummary | null>(null);
  const [loadingEvent, setLoadingEvent] = useState(true);

  const [documentType, setDocumentType] = useState<DocumentType>('CC');
  const [documentNumber, setDocumentNumber] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [justification, setJustification] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const ev = await eventsService.getById(id);
        setEvent(ev);
      } finally {
        setLoadingEvent(false);
      }
    })();
  }, [id]);

  if (loadingEvent) return null;

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

  if (!event.allowExceptions) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Excepciones no permitidas</Text>
          <Text style={styles.errorBody}>
            Este evento no permite registrar beneficiarios por excepción. Pide
            al coordinador que active la opción si lo necesitas.
          </Text>
          <View style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}>
            <Button label="Volver" variant="secondary" onPress={() => router.back()} />
          </View>
        </View>
      </Screen>
    );
  }

  const trimmedDoc = documentNumber.trim();
  const trimmedFirst = firstName.trim();
  const trimmedLast = lastName.trim();
  const justLen = justification.trim().length;

  const justificationError =
    justLen > 0 && justLen < MIN_JUSTIFICATION
      ? `Faltan ${MIN_JUSTIFICATION - justLen} caracteres`
      : null;

  const formValid =
    trimmedDoc.length >= 4 &&
    trimmedDoc.length <= 20 &&
    /^[A-Za-z0-9]+$/.test(trimmedDoc) &&
    trimmedFirst.length >= 1 &&
    trimmedLast.length >= 1 &&
    justLen >= MIN_JUSTIFICATION &&
    justLen <= MAX_JUSTIFICATION;

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
        justification: justification.trim(),
      });
      // Saltamos directo al wizard con el citizen local. El usuario verá la
      // ficha pre-llenada con los datos que acaba de ingresar.
      router.replace(
        `/event/${id}/delivery/${citizenLocalId}?fromException=1` as never,
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

          <Text style={styles.title}>Registrar excepción</Text>
          <Text style={styles.subtitle}>
            {event.name}
          </Text>

          <View style={styles.infoBanner}>
            <Text style={styles.infoBannerTitle}>¿Cuándo registrar excepción?</Text>
            <Text style={styles.infoBannerBody}>
              Solo si el ciudadano cumple los criterios del evento pero no
              aparece en tu lista. Cada excepción queda auditada y se notifica
              al coordinador.
            </Text>
          </View>

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

          {/* Justificación */}
          <Text style={styles.sectionLabel}>Justificación</Text>
          <Input
            label={`Por qué se entrega por excepción (mín. ${MIN_JUSTIFICATION} caracteres)`}
            value={justification}
            onChangeText={(v) => setJustification(v.slice(0, MAX_JUSTIFICATION))}
            multiline
            numberOfLines={4}
            style={styles.textarea}
            placeholder="Ej. Cumple con el criterio de adulto mayor de la zona rural pero no estaba en el censo inicial."
            error={justificationError ?? undefined}
            hint={
              justificationError
                ? undefined
                : `${justLen} / ${MAX_JUSTIFICATION}`
            }
          />

          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{error}</Text>
            </View>
          )}

          <View style={{ marginTop: spacing.lg }}>
            <Button
              label="Guardar y capturar entrega"
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
});
