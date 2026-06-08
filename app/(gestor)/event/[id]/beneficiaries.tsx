/**
 * Lista de beneficiarios del evento — Sprint 9.1.
 *
 * Búsqueda LIVE por documento o nombre con SQLite (índice → <10ms).
 * Filtros por estado: todos / pendientes / entregados.
 *
 * Cada item al tocar abre el wizard de captura (Sprint 9.2). Por ahora
 * muestra un alert con los datos.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DownloadProgress } from '../../../../components/DownloadProgress';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../../../../components/Screen';
import { beneficiariesService } from '../../../../lib/api/services/beneficiaries.service';
import {
  searchBeneficiaries,
  type CachedBeneficiary,
} from '../../../../lib/offline/db';
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
  TOUCH_MIN,
} from '../../../../lib/theme/tokens';

type Filter = 'all' | 'pending' | 'delivered';

export default function BeneficiariesScreen() {
  const { id: eventId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [sectorModalOpen, setSectorModalOpen] = useState(false);
  const [fullList, setFullList] = useState<CachedBeneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedCount, setLoadedCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const loadFromBackend = async () => {
    if (!eventId) return;
    try {
      await beneficiariesService.listForEvent(eventId, (n) => setLoadedCount(n));
    } catch {
      // Cache ya está disponible si la red falla
    }
    setLoading(false);
    setRefreshing(false);
  };

  // Carga TODA la lista cacheada del evento (offline). La búsqueda y los filtros
  // (sector/estado) se aplican en JS sobre esta lista → funcionan 100% sin
  // internet para TODA la lista asignada al gestor, sin tope de 200.
  const refreshLocal = () => {
    if (!eventId) return;
    setFullList(searchBeneficiaries(eventId, '', 20000));
  };

  // Initial mount: cargar de cache + traer del backend
  useEffect(() => {
    refreshLocal();
    void loadFromBackend().then(() => refreshLocal());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Refresca el cache local cada vez que la pantalla recupera el foco.
  // Importante: tras hacer una captura el wizard hace router.back() y
  // queremos que el beneficiario aparezca como "OK" inmediatamente sin
  // recargar la app o pulir-to-refresh manual.
  useFocusEffect(
    useCallback(() => {
      refreshLocal();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eventId]),
  );

  // Sectores únicos de mi lista (con conteo) para el filtro — offline.
  const sectorOptions = useMemo(() => {
    const c = new Map<string, number>();
    for (const b of fullList) {
      const key = b.sectorName ?? 'Sin sector';
      c.set(key, (c.get(key) ?? 0) + 1);
    }
    return Array.from(c.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [fullList]);

  // Base filtrada por sector (los conteos y chips de estado se calculan sobre
  // el sector elegido — si hay uno seleccionado).
  const bySector = useMemo(
    () =>
      sectorFilter === 'all'
        ? fullList
        : fullList.filter((b) => (b.sectorName ?? 'Sin sector') === sectorFilter),
    [fullList, sectorFilter],
  );

  const counts = useMemo(() => {
    let pending = 0;
    let delivered = 0;
    for (const b of bySector) {
      if (b.deliveryStatus === 'delivered' || b.hasLocalDelivery) delivered++;
      else pending++;
    }
    return { all: bySector.length, pending, delivered };
  }, [bySector]);

  // Búsqueda (documento/nombre) + estado, en JS sobre el sector elegido.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/[\s.\-_]/g, '');
    const qName = query.trim().toLowerCase();
    return bySector.filter((b) => {
      const isDone = b.deliveryStatus === 'delivered' || b.hasLocalDelivery;
      if (filter === 'delivered' && !isDone) return false;
      if (filter === 'pending' && isDone) return false;
      if (q && !b.documentNormalized.includes(q) && !b.nameNormalized.includes(qName))
        return false;
      return true;
    });
  }, [bySector, filter, query]);

  if (loading) {
    return (
      <Screen>
        <DownloadProgress count={loadedCount} />
      </Screen>
    );
  }

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
        <Text style={styles.title}>Beneficiarios</Text>
        <Text style={styles.subtitle}>Busca por documento o nombre</Text>
      </View>

      {/* Search input */}
      <View style={styles.searchWrap}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="12.345.678 ó Carmen Rodríguez"
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      {/* Filtro por sector (solo si tengo más de uno) — dropdown 100% offline.
          Un dropdown+modal aguanta nombres largos y muchos sectores sin
          recortarse (los chips horizontales se encogían por el flex del Screen). */}
      {sectorOptions.length > 1 && (
        <View style={styles.sectorWrap}>
          <Pressable
            onPress={() => setSectorModalOpen(true)}
            style={({ pressed }) => [styles.sectorSelect, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="location-outline" size={16} color={colors.cyan} />
            <Text style={styles.sectorSelectText} numberOfLines={1}>
              {sectorFilter === 'all'
                ? `Todos los sectores · ${fullList.length}`
                : `${sectorFilter} · ${counts.all}`}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      )}

      {/* Chips filter */}
      <View style={styles.chipsRow}>
        <FilterChip
          label={`Todos · ${counts.all}`}
          active={filter === 'all'}
          onPress={() => setFilter('all')}
        />
        <FilterChip
          label={`Pend. · ${counts.pending}`}
          active={filter === 'pending'}
          onPress={() => setFilter('pending')}
          tone="warning"
        />
        <FilterChip
          label={`OK · ${counts.delivered}`}
          active={filter === 'delivered'}
          onPress={() => setFilter('delivered')}
          tone="success"
        />
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={(b) => b.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadFromBackend().then(() => refreshLocal());
            }}
            tintColor={colors.cyan}
            colors={[colors.cyan]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Sin resultados</Text>
            <Text style={styles.emptyBody}>
              {query
                ? 'Ningún beneficiario coincide con la búsqueda.'
                : 'No hay beneficiarios cacheados para este evento.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <BeneficiaryRow
            item={item}
            onPress={() => {
              // Sprint 9.2: navegar al wizard de captura
              router.push(
                `/event/${eventId}/delivery/${item.citizenId}` as never,
              );
            }}
          />
        )}
      />

      {/* Modal selector de sector — aguanta nombres largos + scroll */}
      <Modal
        visible={sectorModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSectorModalOpen(false)}
      >
        <Pressable
          style={styles.sectorBackdrop}
          onPress={() => setSectorModalOpen(false)}
        >
          <Pressable style={styles.sectorSheet} onPress={() => {}}>
            <View style={styles.sectorSheetHandle} />
            <Text style={styles.sectorSheetTitle}>Filtrar por sector</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <SectorOption
                label="Todos los sectores"
                count={fullList.length}
                active={sectorFilter === 'all'}
                onPress={() => {
                  setSectorFilter('all');
                  setSectorModalOpen(false);
                }}
              />
              {sectorOptions.map((s) => (
                <SectorOption
                  key={s.name}
                  label={s.name}
                  count={s.count}
                  active={sectorFilter === s.name}
                  onPress={() => {
                    setSectorFilter(s.name);
                    setSectorModalOpen(false);
                  }}
                />
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function SectorOption({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.sectorOption, pressed && { opacity: 0.6 }]}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={[styles.sectorOptionLabel, active && { color: colors.cyan }]}
          numberOfLines={2}
        >
          {label}
        </Text>
        <Text style={styles.sectorOptionCount}>
          {count.toLocaleString('es-CO')} beneficiarios
        </Text>
      </View>
      {active && <Ionicons name="checkmark" size={20} color={colors.cyan} />}
    </Pressable>
  );
}

function FilterChip({
  label,
  active,
  onPress,
  tone = 'cyan',
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  tone?: 'cyan' | 'warning' | 'success';
}) {
  const accent =
    tone === 'warning' ? colors.warning : tone === 'success' ? colors.success : colors.cyan;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: active ? accent : colors.border,
          backgroundColor: active ? colors.bgInput : 'transparent',
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text
        style={[
          styles.chipText,
          { color: active ? accent : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function BeneficiaryRow({
  item,
  onPress,
}: {
  item: CachedBeneficiary;
  onPress: () => void;
}) {
  const done = item.deliveryStatus === 'delivered' || item.hasLocalDelivery;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <View
        style={[
          styles.avatar,
          {
            backgroundColor: done ? colors.successBg : colors.cyanSoft,
          },
        ]}
      >
        <Text
          style={[
            styles.avatarText,
            { color: done ? colors.success : colors.cyan },
          ]}
        >
          {initials(item.fullName)}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>
          {item.fullName}
        </Text>
        <Text style={styles.docLine} numberOfLines={1}>
          {item.documentType} {item.documentNumber}
          {item.sectorName ? ` · ${item.sectorName}` : ''}
        </Text>
      </View>
      <View
        style={[
          styles.statusChip,
          {
            backgroundColor: done ? colors.successBg : colors.warningBg,
          },
        ]}
      >
        <Text
          style={[
            styles.statusText,
            { color: done ? colors.success : colors.warning },
          ]}
        >
          {item.hasLocalDelivery ? 'LOCAL' : done ? 'OK' : 'PEND.'}
        </Text>
      </View>
    </Pressable>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    marginTop: 2,
  },
  searchWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  searchInput: {
    height: TOUCH_MIN,
    backgroundColor: colors.bgInput,
    borderRadius: radii.full,
    paddingHorizontal: spacing.lg,
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  sectorWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sectorSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: TOUCH_MIN,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgInput,
  },
  sectorSelectText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
  },
  sectorBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sectorSheet: {
    backgroundColor: colors.bgCard,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  sectorSheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.md,
  },
  sectorSheetTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.bold,
    marginBottom: spacing.sm,
  },
  sectorOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectorOptionLabel: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
  },
  sectorOptionCount: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    marginTop: 2,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    borderWidth: 1.5,
  },
  chipText: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    flexGrow: 1,
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
  },
  emptyBody: {
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
  },
  name: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
  },
  docLine: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  statusChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.sm,
  },
  statusText: {
    fontSize: 10,
    fontWeight: fontWeights.bold,
    letterSpacing: 0.5,
  },
});
