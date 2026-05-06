/**
 * Detalle del evento — Sprint 9.1.
 *
 * KPIs reales del operador (entregadas, pendientes, sin sync) calculados
 * desde el SQLite local. Trae beneficiarios del backend en background al
 * abrir y los persiste para offline.
 *
 * CTAs:
 *   - Capturar entrega → /event/[id]/search (próximo: wizard)
 *   - Ver lista        → /event/[id]/beneficiaries
 *
 * Sprint 9.2 agregará:
 *   - Banner de estado offline
 *   - Detalle de excepciones permitidas / no permitidas
 *   - Reglas de captura visibles
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../../../../components/Screen';
import { Button } from '../../../../components/Button';
import {
  eventsService,
  type EventSummary,
} from '../../../../lib/api/services/events.service';
import { beneficiariesService } from '../../../../lib/api/services/beneficiaries.service';
import { getEventCounts, type EventCounts } from '../../../../lib/offline/db';
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from '../../../../lib/theme/tokens';

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<EventSummary | null>(null);
  const [counts, setCounts] = useState<EventCounts>({
    total: 0,
    delivered: 0,
    pending: 0,
    hasLocalDelivery: 0,
    pendingSync: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

  const refreshLocalCounts = () => {
    if (!id) return;
    setCounts(getEventCounts(id));
  };

  const load = async () => {
    if (!id) return;
    try {
      // 1. Detalle del evento (offline-first)
      const ev = await eventsService.getById(id);
      setEvent(ev);

      // 2. Beneficiarios al cache (background)
      try {
        await beneficiariesService.listForEvent(id);
        setBannerError(null);
      } catch (e) {
        setBannerError(
          e instanceof Error
            ? `Beneficiarios: ${e.message}`
            : 'No se pudo refrescar la lista',
        );
      }

      // 3. Re-leer counts del SQLite
      refreshLocalCounts();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Al volver del wizard / beneficiarios / sync, refrescamos los counters
  // del SQLite. No hace falta volver a llamar al backend (lento) — el
  // local-first ya tiene los datos correctos.
  useFocusEffect(
    useCallback(() => {
      refreshLocalCounts();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]),
  );

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.cyan} size="large" />
        </View>
      </Screen>
    );
  }

  if (!event) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.errorText}>Evento no encontrado</Text>
          <View style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}>
            <Button label="Volver" variant="secondary" onPress={() => router.back()} />
          </View>
        </View>
      </Screen>
    );
  }

  const isDraft = event.status === 'draft';
  const progressPct =
    counts.total > 0
      ? Math.round((counts.delivered / counts.total) * 100)
      : 0;

  // M1: gestor "completó" cuando ya no le quedan pendientes en la lista
  // (Tipo A) o cuando el evento se cerró desde el backend.
  const eventClosed =
    event.status === 'completed' || event.status === 'archived';
  const listFullyDelivered =
    event.type === 'A' && counts.total > 0 && counts.pending === 0;
  const isCompleted = eventClosed || listFullyDelivered;

  return (
    <Screen padding="none">
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.cyan}
            colors={[colors.cyan]}
          />
        }
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.backText}>← Mis eventos</Text>
        </Pressable>

        <Text style={styles.title}>{event.name}</Text>
        <Text style={styles.subtitle}>
          {event.municipio} ·{' '}
          {event.type === 'A' ? 'Tipo A · lista' : 'Tipo B · auto-registro'}
        </Text>

        {/* Banner draft — bloqueo preventivo */}
        {isDraft && (
          <View style={styles.warningBanner}>
            <Text style={styles.warningTitle}>Evento en borrador</Text>
            <Text style={styles.warningBody}>
              No puedes capturar todavía. Pide al coordinador que active el
              evento desde su panel.
            </Text>
          </View>
        )}

        {/* Banner completado — el gestor ya terminó (M1) */}
        {!isDraft && isCompleted && (
          <View style={styles.successBanner}>
            <Text style={styles.successTitle}>
              {eventClosed ? '✓ Evento cerrado' : '✓ Lista completada'}
            </Text>
            <Text style={styles.successBody}>
              {eventClosed
                ? 'El coordinador cerró este evento. Ya no puedes capturar nuevas entregas, pero puedes consultar tus registros.'
                : 'Ya entregaste a todos los beneficiarios de tu lista. Si necesitas revisar algún registro, ábrelo desde la lista.'}
            </Text>
          </View>
        )}

        {/* Banner refresh fallido */}
        {bannerError && (
          <View style={styles.softBanner}>
            <Text style={styles.softBannerText}>{bannerError}</Text>
          </View>
        )}

        {/* Hero — progreso del día */}
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Progreso de mi lista</Text>
          <View style={styles.heroRow}>
            <Text style={styles.heroNumber}>{counts.delivered}</Text>
            <Text style={styles.heroDenom}>/ {counts.total}</Text>
            <View style={{ flex: 1 }} />
            <View style={styles.pct}>
              <Text style={styles.pctText}>{progressPct}%</Text>
            </View>
          </View>
          <View style={styles.progressBg}>
            <View
              style={[
                styles.progressFill,
                { width: `${progressPct}%` as `${number}%` },
              ]}
            />
          </View>
        </View>

        {/* KPIs grid 2x2 */}
        <View style={styles.kpiGrid}>
          <KpiCard
            label="Pendientes"
            value={counts.pending}
            tone={counts.pending > 0 ? 'warning' : 'muted'}
          />
          <KpiCard
            label="Entregadas hoy"
            value={counts.delivered}
            tone="success"
          />
          <KpiCard
            label="Sin sincronizar"
            value={counts.pendingSync}
            tone={counts.pendingSync > 0 ? 'warning' : 'muted'}
          />
          <KpiCard
            label="Capturas locales"
            value={counts.hasLocalDelivery}
            tone="info"
          />
        </View>

        {/* CTAs */}
        <View style={styles.ctaRow}>
          {isDraft ? (
            <View style={styles.ctaBlocked}>
              <Text style={styles.ctaBlockedText}>Captura bloqueada (borrador)</Text>
            </View>
          ) : isCompleted ? (
            // M1: ya no se captura. CTA primario lleva a revisar registros.
            <Button
              label="Ver mis registros"
              variant="primary"
              onPress={() => {
                router.push(`/event/${event.id}/beneficiaries` as never);
              }}
            />
          ) : event.type === 'B' ? (
            // T1-T3 mobile: en Tipo B no hay lista pre-cargada — el copy
            // debe ser "Añadir registro" y el flujo va directo al formulario
            // de captura ad-hoc (no a beneficiaries que es lista vacía).
            <Button
              label="Añadir registro"
              variant="primary"
              onPress={() => {
                router.push(`/event/${event.id}/new` as never);
              }}
            />
          ) : (
            <Button
              label="Capturar entrega"
              variant="primary"
              onPress={() => {
                router.push(`/event/${event.id}/beneficiaries` as never);
              }}
            />
          )}
          {!isCompleted && (
            <>
              <View style={{ height: spacing.sm }} />
              <Button
                label={
                  event.type === 'B'
                    ? 'Ver lista de registros'
                    : 'Ver lista de beneficiarios'
                }
                variant="secondary"
                onPress={() => {
                  router.push(`/event/${event.id}/beneficiaries` as never);
                }}
              />
            </>
          )}
          {/* Sprint 9.4 — Excepciones offline. Solo si el evento las permite,
              no está draft y la lista no está completa. */}
          {!isDraft && !isCompleted && event.allowExceptions && (
            <View style={{ marginTop: spacing.sm }}>
              <Button
                label="+ Registrar excepción"
                variant="secondary"
                onPress={() => {
                  router.push(`/event/${event.id}/exception` as never);
                }}
              />
            </View>
          )}
          {counts.pendingSync > 0 && (
            <View style={{ marginTop: spacing.sm }}>
              <Button
                label={`⬆ Sincronizar (${counts.pendingSync} pendientes)`}
                variant="secondary"
                onPress={() => {
                  router.push(`/event/${event.id}/sync` as never);
                }}
              />
            </View>
          )}
        </View>

        {/* Info evento */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Información del evento</Text>
          <InfoRow label="Estado" value={statusLabel(event.status)} />
          <InfoRow label="Tipo" value={event.type === 'A' ? 'Lista pre-cargada' : 'Auto-registro'} />
          <InfoRow
            label="Excepciones"
            value={event.allowExceptions ? 'Permitidas' : 'No permitidas'}
          />
          <InfoRow label="Departamento" value={event.departamento || '—'} />
          <InfoRow label="Municipio" value={event.municipio || '—'} />
        </View>
      </ScrollView>
    </Screen>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'success' | 'warning' | 'info' | 'muted';
}) {
  const valueColor = {
    success: colors.success,
    warning: colors.warning,
    info: colors.cyan,
    muted: colors.textPrimary,
  }[tone];

  return (
    <View style={styles.kpiCard}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={[styles.kpiValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoRowLabel}>{label}</Text>
      <Text style={styles.infoRowValue}>{value}</Text>
    </View>
  );
}

function statusLabel(s: EventSummary['status']): string {
  switch (s) {
    case 'active':
      return 'Activo';
    case 'paused':
      return 'Pausado';
    case 'draft':
      return 'Borrador';
    case 'completed':
      return 'Completado';
    case 'archived':
      return 'Archivado';
  }
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
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
    marginBottom: spacing.md,
  },
  warningBanner: {
    backgroundColor: colors.warningBg,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    borderRadius: radii.md,
    padding: spacing.md,
    marginVertical: spacing.sm,
  },
  warningTitle: {
    color: colors.warning,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  warningBody: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  successBanner: {
    backgroundColor: colors.successBg,
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
    borderRadius: radii.md,
    padding: spacing.md,
    marginVertical: spacing.sm,
  },
  successTitle: {
    color: colors.success,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  successBody: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  softBanner: {
    backgroundColor: colors.bgInput,
    borderRadius: radii.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  softBannerText: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
  },
  hero: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cyan,
    marginTop: spacing.md,
  },
  heroLabel: {
    color: colors.cyan,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  heroNumber: {
    color: colors.textPrimary,
    fontSize: 36,
    fontWeight: fontWeights.extrabold,
    fontVariant: ['tabular-nums'],
  },
  heroDenom: {
    color: colors.textSecondary,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
  },
  pct: {
    backgroundColor: colors.cyanSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  pctText: {
    color: colors.cyan,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
  },
  progressBg: {
    height: 6,
    backgroundColor: colors.bgInput,
    borderRadius: radii.full,
    overflow: 'hidden',
    marginTop: spacing.md,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.cyan,
    borderRadius: radii.full,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  kpiCard: {
    flexBasis: '48%',
    backgroundColor: colors.bgCard,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kpiLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: fontWeights.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  kpiValue: {
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.extrabold,
    marginTop: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
  ctaRow: {
    marginTop: spacing.lg,
  },
  ctaBlocked: {
    backgroundColor: colors.bgInput,
    borderRadius: radii.full,
    padding: spacing.md,
    alignItems: 'center',
  },
  ctaBlockedText: {
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
  },
  infoCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoTitle: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoRowLabel: {
    color: colors.textMuted,
    fontSize: fontSizes.sm,
  },
  infoRowValue: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
  },
  errorText: {
    color: colors.error,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
  },
});
