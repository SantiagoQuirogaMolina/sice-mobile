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

import { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Screen } from '../../../components/Screen';
import { Button } from '../../../components/Button';
import {
  listDeliveriesByStatus,
  listPendingCitizensByStatus,
  listPendingEbsByStatus,
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
  const dPending = listDeliveriesByStatus('pending').length;
  const dError = listDeliveriesByStatus('error').length;
  const dBlocked = listDeliveriesByStatus('blocked').length;
  const dConflict = listDeliveriesByStatus('conflict').length;
  const dSynced = listDeliveriesByStatus('synced').length;

  return {
    deliveriesPending: dPending + dError,
    deliveriesBlocked: dBlocked + dConflict,
    deliveriesSynced: dSynced,
    citizensPending:
      listPendingCitizensByStatus('pending').length +
      listPendingCitizensByStatus('error').length,
    citizensBlocked: listPendingCitizensByStatus('blocked').length,
    ebsPending:
      listPendingEbsByStatus('pending').length +
      listPendingEbsByStatus('error').length,
    ebsBlocked: listPendingEbsByStatus('blocked').length,
  };
}

export default function SyncTab() {
  const [totals, setTotals] = useState<Totals>(computeTotals);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [lastResult, setLastResult] = useState<string | null>(null);

  const refresh = () => setTotals(computeTotals());

  useEffect(() => {
    refresh();
    const unsub = subscribeQueueEvents((e) => {
      if (e.type === 'batch-start') {
        setSyncing(true);
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
      }
    });
    return unsub;
  }, []);

  const startSync = async () => {
    setLastResult(null);
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
              ? `${totals.citizensBlocked + totals.ebsBlocked} bloqueadas — el backend rechazó el alta o el vínculo. Entrá al evento para ver detalle.`
              : ''}
          </Text>
        </View>
      )}

      {/* Acciones */}
      <View style={styles.actions}>
        {totalPending > 0 && (
          <Button
            label={syncing ? `Sincronizando ${progress.done}/${progress.total}…` : '⬆ Sincronizar todo ahora'}
            onPress={() => void startSync()}
            disabled={syncing}
            loading={syncing}
          />
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

      <Text style={styles.foot}>
        Para reintentar capturas bloqueadas individualmente, entrá al evento
        correspondiente desde Inicio → Sincronizar.
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
  foot: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
    textAlign: 'center',
    lineHeight: 18,
  },
});
