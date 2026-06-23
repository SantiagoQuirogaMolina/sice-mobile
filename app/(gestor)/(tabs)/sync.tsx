/**
 * Sync global — agregado de capturas y excepciones pendientes de TODOS
 * los eventos del operador.
 *
 * Razón de existir: el operador rota entre eventos durante el día. Si solo
 * tuviese sync por evento, podría olvidar pendientes en otro evento que ya
 * cerró. Esta vista los muestra todos juntos.
 *
 * Si querés ver el detalle por captura individual + retry → entrá al
 * evento y usá /event/[id]/sync (la pantalla preexistente).
 */

import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Screen } from '../../../components/Screen';
import { Button } from '../../../components/Button';
import {
  countDeliveriesByStatus,
  countPendingCitizensByStatus,
  countPendingEbsByStatus,
  listProblemDeliveries,
  unblockDelivery,
  type DeliveryProblemRow,
} from '../../../lib/offline/db';
import {
  processSyncQueue,
  subscribeQueueEvents,
} from '../../../lib/sync/queue';
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from '../../../lib/theme/tokens';

interface Totals {
  deliveriesPending: number; // pending + error
  deliveriesBlocked: number; // blocked + conflict
  deliveriesSynced: number;
  citizensPending: number;
  citizensBlocked: number;
  ebsPending: number;
  ebsBlocked: number;
}

function computeTotals(): Totals {
  // COUNT ligero (sin materializar base64 de foto/firma) — antes contar con
  // list().length cargaba TODAS las filas a memoria, inviable con miles.
  return {
    deliveriesPending:
      countDeliveriesByStatus('pending') + countDeliveriesByStatus('error'),
    deliveriesBlocked:
      countDeliveriesByStatus('blocked') + countDeliveriesByStatus('conflict'),
    deliveriesSynced: countDeliveriesByStatus('synced'),
    citizensPending:
      countPendingCitizensByStatus('pending') + countPendingCitizensByStatus('error'),
    citizensBlocked: countPendingCitizensByStatus('blocked'),
    ebsPending:
      countPendingEbsByStatus('pending') + countPendingEbsByStatus('error'),
    ebsBlocked: countPendingEbsByStatus('blocked'),
  };
}

export default function SyncTab() {
  const [totals, setTotals] = useState<Totals>(computeTotals);
  const [problems, setProblems] = useState<DeliveryProblemRow[]>(() =>
    listProblemDeliveries(100),
  );
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [lastResult, setLastResult] = useState<string | null>(null);
  // Reintento automático en curso: la UI muestra "Reintentando en Ns…" en vez de
  // quedar muda (lo que hacía que el operador tocara "Sincronizar" a mano).
  const [autoRetry, setAutoRetry] = useState<{ inSeconds: number; pending: number } | null>(null);

  const refresh = () => {
    setTotals(computeTotals());
    setProblems(listProblemDeliveries(100));
  };

  useEffect(() => {
    refresh();
    const unsub = subscribeQueueEvents((e) => {
      if (e.type === 'batch-start') {
        setSyncing(true);
        setAutoRetry(null);
        setProgress({ done: 0, total: e.total });
      } else if (e.type === 'item-done') {
        setProgress((p) => ({ ...p, done: p.done + 1 }));
        refresh();
      } else if (e.type === 'batch-end') {
        setSyncing(false);
        setLastResult(
          `${e.ok} ok · ${e.failed} falló · ${e.blocked} bloqueada${e.blocked === 1 ? '' : 's'}`,
        );
        refresh();
      } else if (e.type === 'retry-scheduled') {
        // La cola reintentará sola: mostramos el countdown (no "Sincronizar" mudo).
        setAutoRetry({ inSeconds: e.inSeconds, pending: e.pending });
      } else if (e.type === 'retry-firing') {
        setAutoRetry(null);
      }
    });
    return unsub;
  }, []);

  // Countdown del reintento automático (1s).
  useEffect(() => {
    if (!autoRetry) return;
    const t = setInterval(() => {
      setAutoRetry((a) => (a && a.inSeconds > 0 ? { ...a, inSeconds: a.inSeconds - 1 } : a));
    }, 1000);
    return () => clearInterval(t);
  }, [autoRetry === null]);

  // Cronómetro en vivo mientras sincroniza → permite estimar el tiempo restante.
  useEffect(() => {
    if (!syncing) return;
    const start = Date.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [syncing]);

  // Re-hidrata contadores + lista al GANAR FOCO (al volver a la pestaña). Sin esto,
  // los tabs no se re-montan y los totales quedaban STALE: capturas hechas en otra
  // pantalla o un sync ya completado no se reflejaban → la pestaña "no funcionaba".
  useFocusEffect(
    useCallback(() => {
      setTotals(computeTotals());
      setProblems(listProblemDeliveries(100));
    }, []),
  );

  const startSync = async () => {
    setLastResult(null);
    await processSyncQueue();
  };

  // Reintento por captura: la desbloquea y dispara el drain (el mutex evita solapes).
  const retryOne = async (id: string) => {
    unblockDelivery(id);
    refresh();
    await processSyncQueue();
  };

  const totalPending =
    totals.deliveriesPending +
    totals.citizensPending +
    totals.ebsPending;
  const totalBlocked =
    totals.deliveriesBlocked + totals.citizensBlocked + totals.ebsBlocked;
  const allClean = totalPending === 0 && totalBlocked === 0;

  const heroColor = allClean
    ? colors.success
    : totalBlocked > 0
      ? colors.warning
      : colors.cyan;

  const heroLabel = allClean
    ? '✓ Todo sincronizado'
    : totalBlocked > 0
      ? `⚠ ${totalBlocked} bloqueada${totalBlocked === 1 ? '' : 's'}`
      : `⏳ ${totalPending} por enviar`;

  // Restante + estimado de tiempo (en vivo) mientras sincroniza.
  const remaining = Math.max(0, progress.total - progress.done);
  const rate = elapsed > 0 ? progress.done / elapsed : 0;
  const etaSec = rate > 0 && remaining > 0 ? Math.ceil(remaining / rate) : null;
  const etaLabel =
    etaSec == null ? '' : etaSec < 60 ? `~${etaSec}s` : `~${Math.ceil(etaSec / 60)} min`;

  return (
    <Screen padding="none">
      <View style={styles.header}>
        <Text style={styles.title}>Sincronización</Text>
        <Text style={styles.subtitle}>
          Pendientes globales (todos tus eventos)
        </Text>
      </View>

      <View style={[styles.hero, { borderColor: heroColor }]}>
        <Text style={[styles.heroLabel, { color: heroColor }]}>
          {heroLabel}
        </Text>
        <View style={styles.kpiRow}>
          <KpiBox label="Capturas" value={totals.deliveriesPending} tone="warning" />
          <KpiBox label="OK" value={totals.deliveriesSynced} tone="success" />
          <KpiBox label="Bloqueadas" value={totalBlocked} tone="warning" />
        </View>
      </View>

      {/* Excepciones offline (citizens + EBs) — sub-bloque */}
      {(totals.citizensPending +
        totals.ebsPending +
        totals.citizensBlocked +
        totals.ebsBlocked) > 0 && (
        <View style={styles.excSection}>
          <Text style={styles.sectionTitle}>Excepciones offline</Text>
          <Text style={styles.excBody}>
            {totals.citizensPending + totals.ebsPending > 0
              ? `${totals.citizensPending + totals.ebsPending} pasos pendientes para registrar al ciudadano y vincularlo al evento.\n`
              : ''}
            {totals.citizensBlocked + totals.ebsBlocked > 0
              ? `${totals.citizensBlocked + totals.ebsBlocked} bloqueadas — el servidor rechazó el registro o el vínculo. Entrá al evento para ver el detalle.`
              : ''}
          </Text>
        </View>
      )}

      {/* Acciones */}
      <View style={styles.actions}>
        {(totalPending > 0 || totalBlocked > 0) && (
          <Button
            label={
              syncing
                ? `Sincronizando ${progress.done}/${progress.total}…`
                : totalPending > 0
                  ? '⬆ Sincronizar todo ahora'
                  : `↻ Reintentar ${totalBlocked} bloqueada${totalBlocked === 1 ? '' : 's'}`
            }
            onPress={() => void startSync()}
            disabled={syncing}
            loading={syncing}
          />
        )}
        {syncing && progress.total > 0 && (
          <View style={styles.progressWrap}>
            <View style={styles.progressBg}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%` as `${number}%`,
                  },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {progress.done} / {progress.total} · faltan {remaining}
              {etaLabel ? ` · ${etaLabel} restante` : ''}
            </Text>
          </View>
        )}
        {autoRetry && !syncing && (
          <View style={styles.autoRetryWrap}>
            <Text style={styles.autoRetryText}>
              ↻ Reintentando solo en {autoRetry.inSeconds}s… ({autoRetry.pending} pendiente
              {autoRetry.pending === 1 ? '' : 's'})
            </Text>
            <Text style={styles.autoRetryHint}>
              No tienes que hacer nada — la app reintenta automáticamente.
            </Text>
          </View>
        )}
        {allClean && (
          <View style={styles.cleanCard}>
            <Text style={styles.cleanText}>
              No hay nada por sincronizar. Las capturas que hagas mientras
              estés offline van a aparecer acá automáticamente.
            </Text>
          </View>
        )}
        {lastResult && !syncing && (
          <Text style={styles.lastResult}>Último intento: {lastResult}</Text>
        )}
      </View>

      {/* Detalle por captura con problema + reintento individual ─────────── */}
      {problems.length > 0 && !syncing && (
        <View style={styles.problemsCard}>
          <Text style={styles.problemsTitle}>
            Capturas con problema ({problems.length}
            {problems.length >= 100 ? '+' : ''})
          </Text>
          <ScrollView style={styles.problemsScroll} nestedScrollEnabled>
            {problems.map((p) => {
              const cfg = problemConfig(p.syncStatus);
              return (
                <View key={p.id} style={styles.problemRow}>
                  <View style={[styles.problemDot, { backgroundColor: cfg.bg }]}>
                    <Text style={[styles.problemGlyph, { color: cfg.color }]}>{cfg.glyph}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.problemFolio}>
                      SICE-{p.id.slice(0, 8).toUpperCase()}
                    </Text>
                    <Text style={styles.problemError} numberOfLines={2}>
                      {p.lastError ?? cfg.label}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => void retryOne(p.id)}
                    style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.retryText}>Reintentar</Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      <Text style={styles.foot}>
        Toca «Reintentar» en una captura con problema, o «Reintentar bloqueadas»
        para todas. Para ver el detalle completo de un evento, entrá desde Inicio.
      </Text>
    </Screen>
  );
}

function KpiBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'success' | 'warning';
}) {
  const accent = tone === 'success' ? colors.success : colors.warning;
  return (
    <View style={styles.kpiBox}>
      <Text
        style={[
          styles.kpiValue,
          { color: value === 0 ? colors.textMuted : accent },
        ]}
      >
        {value}
      </Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function problemConfig(status: DeliveryProblemRow['syncStatus']): {
  glyph: string;
  color: string;
  bg: string;
  label: string;
} {
  if (status === 'blocked')
    return { glyph: '⚠', color: colors.warning, bg: colors.warningBg, label: 'Bloqueada' };
  if (status === 'conflict')
    return { glyph: '!', color: colors.conflict, bg: colors.warningBg, label: 'Conflicto' };
  return { glyph: '⟲', color: colors.error, bg: colors.errorBg, label: 'Error · reintentando' };
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.extrabold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    marginTop: 2,
  },
  hero: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
  },
  heroLabel: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  kpiBox: {
    flex: 1,
    alignItems: 'center',
  },
  kpiValue: {
    fontSize: fontSizes.xxxl,
    fontWeight: fontWeights.extrabold,
    fontVariant: ['tabular-nums'],
  },
  kpiLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: fontWeights.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  excSection: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.cyanSoft,
    borderRadius: radii.md,
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.cyan,
  },
  sectionTitle: {
    color: colors.cyan,
    fontSize: 10,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  excBody: {
    color: colors.textPrimary,
    fontSize: fontSizes.xs,
    lineHeight: 18,
  },
  actions: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  progressWrap: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  progressBg: {
    height: 8,
    backgroundColor: colors.bgInput,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.cyan,
    borderRadius: radii.full,
  },
  progressText: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  cleanCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cleanText: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  lastResult: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  autoRetryWrap: {
    marginTop: spacing.md,
    backgroundColor: colors.cyanSoft,
    borderRadius: radii.md,
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.cyan,
  },
  autoRetryText: {
    color: colors.cyan,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.bold,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  autoRetryHint: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    textAlign: 'center',
    marginTop: 2,
  },
  foot: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
    textAlign: 'center',
    lineHeight: 18,
  },
  problemsCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: colors.bgCard,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.warning,
    paddingVertical: spacing.sm,
  },
  problemsTitle: {
    color: colors.warning,
    fontSize: 10,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  problemsScroll: {
    maxHeight: 260,
  },
  problemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  problemDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  problemGlyph: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
  },
  problemFolio: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    fontVariant: ['tabular-nums'],
  },
  problemError: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    marginTop: 1,
    lineHeight: 15,
  },
  retryBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: colors.warningBg,
  },
  retryText: {
    color: colors.warning,
    fontSize: 10,
    fontWeight: fontWeights.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
