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
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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
  const [fullList, setFullList] = useState<CachedBeneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadFromBackend = async () => {
    if (!eventId) return;
    try {
      await beneficiariesService.listForEvent(eventId);
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
        <View style={styles.center}>
          <ActivityIndicator color={colors.cyan} size="large" />
          <Text style={styles.loadingText}>Cargando beneficiarios…</Text>
        </View>
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

      {/* Filtro por sector (solo si tengo más de uno) — 100% offline */}
      {sectorOptions.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sectorRow}
        >
          <FilterChip
            label={`Todos los sectores · ${fullList.length}`}
            active={sectorFilter === 'all'}
            onPress={() => setSectorFilter('all')}
          />
          {sectorOptions.map((s) => (
            <FilterChip
              key={s.name}
              label={`${s.name} · ${s.count}`}
              active={sectorFilter === s.name}
              onPress={() => setSectorFilter(s.name)}
            />
          ))}
        </ScrollView>
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
    </Screen>
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: fontSizes.sm,
  },
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
  sectorRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
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
