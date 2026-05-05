/**
 * Sync screen — sube las capturas pendientes al backend.
 *
 * Sprint 9.3: el operador toca "Sincronizar ahora" y la cola procesa el
 * batch (10 capturas máx) subiendo evidencia + delivery por cada una.
 *
 * Banner de estado:
 *   - Pendientes: cuántas faltan por subir
 *   - Sincronizadas: cuántas ya están en backend
 *   - Bloqueadas: cuántas requieren acción del coordinador (event en draft, etc)
 *
 * Lista por captura mostrando estado individual + tap para "reintentar"
 * cuando está blocked.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../../../../components/Screen';
import { Button } from '../../../../components/Button';
import {
  listDeliveriesByEvent,
  unblockDelivery,
  type PendingDelivery,
  type SyncStatus,
} from '../../../../lib/offline/db';
import {
  processSyncQueue,
  subscribeQueueEvents,
} from '../../../../lib/sync/queue';
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from '../../../../lib/theme/tokens';

export default function SyncScreen() {
  const { id: eventId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [items, setItems] = useState<PendingDelivery[]>([]);
  const [progress, setProgress] = useState({
    inFlight: false,
    total: 0,
    done: 0,
  });

  const refresh = () => {
    if (!eventId) return;
    const list = listDeliveriesByEvent(eventId).sort((a, b) => {
      // Prioridad visual: error/blocked arriba, después syncing, después pending, después synced
      const order: Record<SyncStatus, number> = {
        blocked: 0,
        conflict: 1,
        error: 2,
        syncing: 3,
        pending: 4,
        synced: 5,
      };
      return order[a.syncStatus] - order[b.syncStatus];
    });
    setItems(list);
  };

  useEffect(() => {
    refresh();
    const unsub = subscribeQueueEvents((e) => {
      if (e.type === 'batch-start') {
        setProgress({ inFlight: true, total: e.total, done: 0 });
      }
      if (e.type === 'item-done') {
        setProgress((p) => ({ ...p, done: p.done + 1 }));
        refresh();
      }
      if (e.type === 'batch-end') {
        setProgress({ inFlight: false, total: 0, done: 0 });
        refresh();
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const buckets = useMemo(() => {
    const acc = {
      pending: 0,
      syncing: 0,
      synced: 0,
      error: 0,
      blocked: 0,
      conflict: 0,
    };
    for (const i of items) acc[i.syncStatus]++;
    return acc;
  }, [items]);

  const totalPending = buckets.pending + buckets.error;
  const pct =
    progress.inFlight && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

  const startSync = async () => {
    await processSyncQueue();
  };

  const retryBlocked = async () => {
    const blocked = items.filter(
      (i) => i.syncStatus === 'blocked' || i.syncStatus === 'error',
    );
    for (const b of blocked) unblockDelivery(b.id);
    refresh();
    await processSyncQueue();
  };

  return (
    <Screen padding="none">
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.backText}>← Atrás</Text>
        </Pressable>
        <Text style={styles.title}>Sincronización</Text>
      </View>

      {/* Hero */}
      <View
        style={[
          styles.hero,
          {
            borderColor:
              totalPending === 0 && buckets.blocked === 0
                ? colors.success
                : buckets.blocked > 0
                  ? colors.warning
                  : colors.cyan,
          },
        ]}
      >
        <Text
          style={[
            styles.heroLabel,
            {
              color:
                totalPending === 0 && buckets.blocked === 0
                  ? colors.success
                  : buckets.blocked > 0
                    ? colors.warning
                    : colors.cyan,
            },
          ]}
        >
          {totalPending === 0 && buckets.blocked === 0
            ? '✓ Todo sincronizado'
            : buckets.blocked > 0
              ? `⚠ ${buckets.blocked} bloqueadas requieren acción`
              : `⏳ ${totalPending} por enviar`}
        </Text>
        <View style={styles.heroNumbers}>
          <View style={styles.heroBox}>
            <Text style={styles.heroBoxValue}>{totalPending}</Text>
            <Text style={styles.heroBoxLabel}>Por enviar</Text>
          </View>
          <View style={styles.heroBox}>
            <Text style={[styles.heroBoxValue, { color: colors.success }]}>
              {buckets.synced}
            </Text>
            <Text style={styles.heroBoxLabel}>OK</Text>
          </View>
          <View style={styles.heroBox}>
            <Text style={[styles.heroBoxValue, { color: colors.warning }]}>
              {buckets.blocked + buckets.conflict}
            </Text>
            <Text style={styles.heroBoxLabel}>Bloqueadas</Text>
          </View>
        </View>
        {progress.inFlight && (
          <View style={styles.progressWrap}>
            <View style={styles.progressBg}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${pct}%` as `${number}%` },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {progress.done} / {progress.total}
            </Text>
          </View>
        )}
      </View>

      {/* Acciones */}
      <View style={styles.actions}>
        {totalPending > 0 && (
          <Button
            label={progress.inFlight ? 'Sincronizando…' : '⬆ Sincronizar ahora'}
            onPress={() => void startSync()}
            disabled={progress.inFlight}
            loading={progress.inFlight}
          />
        )}
        {(buckets.blocked > 0 || buckets.conflict > 0) && (
          <View style={{ marginTop: spacing.sm }}>
            <Button
              label={`Reintentar las ${buckets.blocked + buckets.conflict} bloqueadas`}
              variant="secondary"
              onPress={() => void retryBlocked()}
              disabled={progress.inFlight}
            />
          </View>
        )}
      </View>

      {/* Lista */}
      <FlatList
        data={items}
        keyExtractor={(d) => d.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No hay capturas en este evento todavía.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <DeliveryRow
            item={item}
            onRetry={
              item.syncStatus === 'blocked' || item.syncStatus === 'error'
                ? async () => {
                    unblockDelivery(item.id);
                    refresh();
                    await processSyncQueue();
                  }
                : undefined
            }
          />
        )}
      />
    </Screen>
  );
}

function DeliveryRow({
  item,
  onRetry,
}: {
  item: PendingDelivery;
  onRetry?: () => void;
}) {
  const config = statusConfig(item.syncStatus);
  return (
    <View style={styles.row}>
      <View
        style={[styles.rowIcon, { backgroundColor: config.bg }]}
      >
        {item.syncStatus === 'syncing' ? (
          <ActivityIndicator size="small" color={config.color} />
        ) : (
          <Text style={[styles.rowIconText, { color: config.color }]}>
            {config.glyph}
          </Text>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>
          SICE-{item.id.slice(0, 8).toUpperCase()}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {captureMeta(item)}
        </Text>
      </View>
      {onRetry && (
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retryBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      )}
    </View>
  );
}

function statusConfig(status: SyncStatus): {
  glyph: string;
  color: string;
  bg: string;
} {
  switch (status) {
    case 'synced':
      return { glyph: '✓', color: colors.success, bg: colors.successBg };
    case 'syncing':
      return { glyph: '⬆', color: colors.cyan, bg: colors.cyanSoft };
    case 'pending':
      return { glyph: '⏳', color: colors.warning, bg: colors.warningBg };
    case 'error':
      return { glyph: '⟲', color: colors.error, bg: colors.errorBg };
    case 'blocked':
      return { glyph: '⚠', color: colors.warning, bg: colors.warningBg };
    case 'conflict':
      return { glyph: '!', color: colors.conflict, bg: colors.warningBg };
  }
}

function captureMeta(d: PendingDelivery): string {
  const t = new Date(d.capturedAt).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (d.syncStatus === 'synced') return `Sincronizada · ${t}`;
  if (d.syncStatus === 'error') {
    return d.lastError ?? `Error · reintentando · ${t}`;
  }
  if (d.syncStatus === 'blocked') {
    if (d.lastError?.includes('EVENT_NOT_CAPTURABLE')) {
      return 'Evento en borrador · contacta al coordinador';
    }
    return d.lastError ?? `Bloqueada · ${t}`;
  }
  if (d.syncStatus === 'conflict') return d.lastError ?? `Conflict · ${t}`;
  if (d.syncStatus === 'syncing') return `Subiendo evidencia… ${d.photoSizeKB ?? 0}KB`;
  return `En cola · ${t}`;
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  back: {
    paddingVertical: spacing.sm,
    alignSelf: 'flex-start',
  },
  backText: {
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.extrabold,
  },
  hero: {
    margin: spacing.lg,
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
  heroNumbers: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  heroBox: {
    flex: 1,
    alignItems: 'center',
  },
  heroBoxValue: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxxl,
    fontWeight: fontWeights.extrabold,
    fontVariant: ['tabular-nums'],
  },
  heroBoxLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: fontWeights.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  progressWrap: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  progressBg: {
    height: 6,
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
  actions: {
    paddingHorizontal: spacing.lg,
  },
  listContent: {
    padding: spacing.lg,
    flexGrow: 1,
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconText: {
    fontSize: 18,
    fontWeight: fontWeights.bold,
  },
  rowTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    fontVariant: ['tabular-nums'],
  },
  rowSubtitle: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    marginTop: 2,
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
