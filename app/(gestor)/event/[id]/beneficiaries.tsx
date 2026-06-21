/**
 * Lista de beneficiarios del evento — Sprint 9.1.
 *
 * Búsqueda LIVE por documento o nombre con SQLite (índice → <10ms).
 * Filtros por estado: todos / pendientes / entregados.
 *
 * Rendimiento (v1.26): la lista PAGINA en SQLite (LIMIT/OFFSET) y la FlatList
 * está virtualizada. Antes traía las 20.000 filas a RAM y filtraba en JS en cada
 * render → se congelaba al abrir y al teclear. Ahora cada filtro va en el WHERE y
 * solo se cargan ~50 filas por página. Sigue 100% offline.
 *
 * Cada item al tocar abre el wizard de captura.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  countBeneficiaries,
  listBeneficiarySectors,
  searchBeneficiariesPage,
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

const PAGE = 50; // filas por página — se cargan más al llegar al final

export default function BeneficiariesScreen() {
  const { id: eventId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [sectorModalOpen, setSectorModalOpen] = useState(false);

  const [page, setPage] = useState<CachedBeneficiary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);

  const [counts, setCounts] = useState({ all: 0, pending: 0, delivered: 0 });
  const [sectors, setSectors] = useState<{ name: string; count: number }[]>([]);
  const [total, setTotal] = useState(0);

  const [loading, setLoading] = useState(true);
  const [loadedCount, setLoadedCount] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Debounce de la búsqueda: re-consultar SQL por keystroke es barato, pero
  // ~250ms evita una consulta por tecla cuando el operador escribe rápido.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const loadFromBackend = async () => {
    if (!eventId) return;
    setDownloading(true);
    let firstPagePainted = false;
    try {
      await beneficiariesService.listForEvent(eventId, (n) => {
        setLoadedCount(n);
        // Apenas la PRIMERA página se persiste, mostramos la lista (no esperamos
        // las 20.000). Las siguientes crecen el cache en segundo plano.
        if (!firstPagePainted) {
          firstPagePainted = true;
          setLoading(false);
          reload();
        }
        refreshSectorsAndTotal(); // el total crece mientras descarga
      });
    } catch {
      // Cache ya está disponible si la red falla
    }
    setDownloading(false);
    setLoading(false);
    setRefreshing(false);
    reload();
    refreshCounts();
    refreshSectorsAndTotal();
  };

  // Carga la PRIMERA página con los filtros actuales (offline, SQLite).
  const reload = useCallback(() => {
    if (!eventId) return;
    const first = searchBeneficiariesPage(eventId, debouncedQuery, {
      status: filter,
      sector: sectorFilter,
      limit: PAGE,
      offset: 0,
    });
    setPage(first);
    offsetRef.current = first.length;
    setHasMore(first.length === PAGE);
  }, [eventId, debouncedQuery, filter, sectorFilter]);

  // Carga la siguiente página y la concatena (scroll infinito).
  const loadMore = useCallback(() => {
    if (!eventId || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const next = searchBeneficiariesPage(eventId, debouncedQuery, {
      status: filter,
      sector: sectorFilter,
      limit: PAGE,
      offset: offsetRef.current,
    });
    setPage((prev) => [...prev, ...next]);
    offsetRef.current += next.length;
    setHasMore(next.length === PAGE);
    setLoadingMore(false);
  }, [eventId, debouncedQuery, filter, sectorFilter, hasMore, loadingMore]);

  // Conteos de los chips — por sector seleccionado (COUNT con índice, sin LIKE).
  const refreshCounts = useCallback(() => {
    if (!eventId) return;
    setCounts({
      all: countBeneficiaries(eventId, { sector: sectorFilter }),
      pending: countBeneficiaries(eventId, { sector: sectorFilter, status: 'pending' }),
      delivered: countBeneficiaries(eventId, { sector: sectorFilter, status: 'delivered' }),
    });
  }, [eventId, sectorFilter]);

  // Sectores + total del evento (para el dropdown).
  const refreshSectorsAndTotal = useCallback(() => {
    if (!eventId) return;
    setSectors(listBeneficiarySectors(eventId));
    setTotal(countBeneficiaries(eventId, {}));
  }, [eventId]);

  // Mount: traer del backend en segundo plano; mostrar el cache de inmediato.
  useEffect(() => {
    if (!eventId) return;
    refreshSectorsAndTotal();
    if (countBeneficiaries(eventId, {}) > 0) setLoading(false);
    void loadFromBackend().then(() => {
      refreshSectorsAndTotal();
      refreshCounts();
      reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Re-paginar cuando cambian los filtros/búsqueda (reload depende de ellos).
  useEffect(() => {
    reload();
  }, [reload]);

  // Re-contar los chips cuando cambia el sector.
  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  // Al recuperar el foco (p.ej. tras capturar): refrescar lista + conteos para
  // que el beneficiario aparezca como OK inmediatamente.
  useFocusEffect(
    useCallback(() => {
      reload();
      refreshCounts();
      refreshSectorsAndTotal();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eventId, debouncedQuery, filter, sectorFilter]),
  );

  const renderItem = useCallback(
    ({ item }: { item: CachedBeneficiary }) => (
      <BeneficiaryRow
        item={item}
        onPress={() =>
          router.push(`/event/${eventId}/delivery/${item.citizenId}` as never)
        }
      />
    ),
    [eventId, router],
  );

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
        {downloading && loadedCount > 0 ? (
          <Text style={[styles.subtitle, { color: colors.cyan }]}>
            ⟳ Descargando lista completa… {loadedCount.toLocaleString('es-CO')}
          </Text>
        ) : (
          <Text style={styles.subtitle}>Busca por documento o nombre</Text>
        )}
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

      {/* Filtro por sector (solo si tengo más de uno) — dropdown 100% offline. */}
      {sectors.length > 1 && (
        <View style={styles.sectorWrap}>
          <Pressable
            onPress={() => setSectorModalOpen(true)}
            style={({ pressed }) => [styles.sectorSelect, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="location-outline" size={16} color={colors.cyan} />
            <Text style={styles.sectorSelectText} numberOfLines={1}>
              {sectorFilter === 'all'
                ? `Todos los sectores · ${total.toLocaleString('es-CO')}`
                : `${sectorFilter} · ${counts.all.toLocaleString('es-CO')}`}
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

      {/* List — virtualizada + paginada */}
      <FlatList
        data={page}
        keyExtractor={(b) => b.id}
        contentContainerStyle={styles.listContent}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews
        onEndReachedThreshold={0.5}
        onEndReached={loadMore}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadFromBackend().then(() => {
                refreshSectorsAndTotal();
                refreshCounts();
                reload();
              });
            }}
            tintColor={colors.cyan}
            colors={[colors.cyan]}
          />
        }
        ListFooterComponent={
          hasMore ? (
            <View style={styles.footer}>
              <ActivityIndicator color={colors.cyan} />
            </View>
          ) : null
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
        renderItem={renderItem}
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
                count={total}
                active={sectorFilter === 'all'}
                onPress={() => {
                  setSectorFilter('all');
                  setSectorModalOpen(false);
                }}
              />
              {sectors.map((s) => (
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

// React.memo: con la lista virtualizada, evita re-renderizar las filas visibles
// cuando cambia el estado del padre (búsqueda, conteos…).
const BeneficiaryRow = memo(function BeneficiaryRow({
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
});

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
  footer: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
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
