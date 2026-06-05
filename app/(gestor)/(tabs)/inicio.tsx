/**
 * Inicio — lista de eventos asignados al operador.
 *
 * Tab principal del operador. Antes era /dashboard; con el TabBar
 * (Sprint 9.6) pasó a ser /inicio. El logout y el perfil migraron a la
 * tab "Yo" para no congestionar el header.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '../../../components/Screen';
import { Button } from '../../../components/Button';
import { useAuthStore } from '../../../lib/stores/auth-store';
import { ApiError } from '../../../lib/api/client';
import { apiErrorMessage } from '../../../lib/api/error-message';
import {
  eventsService,
  type EventSummary,
  type GestorFormField,
} from '../../../lib/api/services/events.service';
import {
  archiveEventLocal,
  listArchivedEventIds,
  listCachedEvents,
  saveCachedEvent,
  unarchiveEventLocal,
} from '../../../lib/offline/db';
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from '../../../lib/theme/tokens';

type SortMode = 'upcoming' | 'recent';

/** Normaliza para búsqueda: minúsculas + sin acentos. */
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Parsea el JSON cacheado de campos del formulario; vacío si falta o corrupto. */
function parseCachedFormFields(json: string | null): GestorFormField[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as GestorFormField[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function InicioTab() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('upcoming');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());

  const userId = user?.id ?? '';

  // Archivados localmente por este operador (declutter; no toca el evento global).
  const loadArchived = useCallback(() => {
    if (!userId) return;
    try {
      setArchivedIds(new Set(listArchivedEventIds(userId)));
    } catch {
      /* noop */
    }
  }, [userId]);

  // Carga del cache local: instantánea y funciona sin red.
  // Filtramos a estados utilizables igual que el flow online.
  const loadFromCache = () => {
    try {
      const cached = listCachedEvents();
      const usable = cached
        .filter(
          (e) =>
            e.status === 'active' ||
            e.status === 'paused' ||
            e.status === 'draft',
        )
        .map<EventSummary>((c) => ({
          id: c.id,
          tenantId: c.tenantId,
          name: c.name,
          type: c.type,
          status: c.status,
          description: c.description,
          startDate: c.startDate,
          endDate: c.endDate,
          departamento: c.departamento ?? '',
          municipio: c.municipio ?? '',
          allowExceptions: c.allowExceptions,
          allowQrSelfRegister: c.allowQrSelfRegister,
          requireSignature: c.requireSignature,
          requirePhoto: c.requirePhoto,
          requireGps: c.requireGps,
          captureDomicilio: c.captureDomicilio,
          totalBeneficiaries: c.totalBeneficiaries,
          totalDelivered: c.totalDelivered,
          customFormFields: parseCachedFormFields(c.customFormFieldsJson),
        }));
      if (usable.length > 0) {
        setEvents(usable);
      }
    } catch {
      // si la BD local está corrupta, dejamos events vacío
    }
  };

  // Refresh desde el backend. Solo se intenta si hay red; si falla
  // mantenemos los datos del cache y mostramos un banner sutil.
  const load = async () => {
    setError(null);
    try {
      const items = await eventsService.listForMe();
      const usable = items.filter(
        (e) =>
          e.status === 'active' || e.status === 'paused' || e.status === 'draft',
      );
      setEvents(usable);
      // Persistimos al cache local para próxima apertura offline
      for (const ev of usable) {
        saveCachedEvent({
          id: ev.id,
          tenantId: ev.tenantId,
          name: ev.name,
          type: ev.type,
          status: ev.status,
          description: ev.description,
          startDate: ev.startDate,
          endDate: ev.endDate,
          departamento: ev.departamento,
          municipio: ev.municipio,
          allowExceptions: ev.allowExceptions,
          allowQrSelfRegister: ev.allowQrSelfRegister,
          requireSignature: ev.requireSignature,
          requirePhoto: ev.requirePhoto,
          requireGps: ev.requireGps,
          captureDomicilio: ev.captureDomicilio,
          totalBeneficiaries: ev.totalBeneficiaries,
          totalDelivered: ev.totalDelivered,
          sectorsJson: null,
          customFormFieldsJson:
            ev.customFormFields.length > 0
              ? JSON.stringify(ev.customFormFields)
              : null,
          lastSyncAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      const isNetwork = e instanceof ApiError && e.code === 'NETWORK_ERROR';
      setError(
        isNetwork
          ? 'Modo offline · Mostrando eventos descargados'
          : apiErrorMessage(e, 'No se pudieron cargar tus eventos. Reintenta.'),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    // 0. Archivados locales (sincrónico)
    loadArchived();
    // 1. Cargar cache inmediatamente (sincrónico, sin red)
    loadFromCache();
    setLoading(false); // ya tenemos datos del cache, no bloqueamos UI
    // 2. Intentar refresh del backend en background
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    void load();
  };

  // Archivar / desarchivar (local).
  const toggleArchive = (ev: EventSummary, isArchived: boolean) => {
    if (!userId) return;
    try {
      if (isArchived) unarchiveEventLocal(ev.id, userId);
      else archiveEventLocal(ev.id, userId);
      loadArchived();
    } catch {
      /* noop */
    }
  };

  const onLongPressEvent = (ev: EventSummary) => {
    const isArchived = archivedIds.has(ev.id);
    Alert.alert(
      ev.name,
      isArchived
        ? 'Este evento está archivado. ¿Desarchivar? Volverá a tu lista de activos.'
        : '¿Archivar este evento? Se ocultará de tu lista (queda guardado y puedes desarchivarlo cuando quieras).',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: isArchived ? 'Desarchivar' : 'Archivar',
          onPress: () => toggleArchive(ev, isArchived),
        },
      ],
    );
  };

  const archivedCount = useMemo(
    () => events.filter((e) => archivedIds.has(e.id)).length,
    [events, archivedIds],
  );
  const activeCount = events.length - archivedCount;
  const showArchiveTab = archivedCount > 0 || view === 'archived';

  // Lista visible = vista (activos/archivados) + búsqueda + orden por fecha.
  // "Próximos" = startDate asc; "Recientes" = endDate desc.
  const visibleEvents = useMemo(() => {
    const q = normalizeText(query.trim());
    return events
      .filter((e) =>
        view === 'archived' ? archivedIds.has(e.id) : !archivedIds.has(e.id),
      )
      .filter(
        (e) =>
          q === '' ||
          normalizeText(e.name).includes(q) ||
          normalizeText(e.municipio).includes(q),
      )
      .sort((a, b) =>
        sortMode === 'upcoming'
          ? new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
          : new Date(b.endDate).getTime() - new Date(a.endDate).getTime(),
      );
  }, [events, archivedIds, view, query, sortMode]);

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.cyan} size="large" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padding="none">
      {/* Header sin botón de salir — el logout vive en la tab "Yo" */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>Hola,</Text>
          <Text style={styles.name}>{user?.fullName ?? 'Operador'}</Text>
          <Text style={styles.tenant}>{user?.tenant?.name ?? ''}</Text>
        </View>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Búsqueda por nombre o municipio */}
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar por nombre o municipio…"
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} style={styles.searchClear} hitSlop={8}>
            <Text style={styles.searchClearText}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* Vista: Activos / Archivados (solo aparece si hay archivados) */}
      {showArchiveTab && (
        <View style={styles.sortRow}>
          <Pressable
            onPress={() => setView('active')}
            style={[styles.sortChip, view === 'active' && styles.sortChipActive]}
          >
            <Text
              style={[styles.sortChipText, view === 'active' && styles.sortChipTextActive]}
            >
              Activos ({activeCount})
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setView('archived')}
            style={[styles.sortChip, view === 'archived' && styles.sortChipActive]}
          >
            <Text
              style={[styles.sortChipText, view === 'archived' && styles.sortChipTextActive]}
            >
              Archivados ({archivedCount})
            </Text>
          </Pressable>
        </View>
      )}

      {/* Orden por fecha */}
      {visibleEvents.length > 1 && (
        <View style={styles.sortRow}>
          <Pressable
            onPress={() => setSortMode('upcoming')}
            style={[
              styles.sortChip,
              sortMode === 'upcoming' && styles.sortChipActive,
            ]}
          >
            <Text
              style={[
                styles.sortChipText,
                sortMode === 'upcoming' && styles.sortChipTextActive,
              ]}
            >
              Próximos
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSortMode('recent')}
            style={[
              styles.sortChip,
              sortMode === 'recent' && styles.sortChipActive,
            ]}
          >
            <Text
              style={[
                styles.sortChipText,
                sortMode === 'recent' && styles.sortChipTextActive,
              ]}
            >
              Recientes
            </Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={visibleEvents}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.cyan}
            colors={[colors.cyan]}
          />
        }
        ListHeaderComponent={
          <Text style={styles.sectionTitle}>
            {view === 'archived'
              ? `${archivedCount} archivado${archivedCount === 1 ? '' : 's'}`
              : query.trim() !== ''
                ? `${visibleEvents.length} resultado${visibleEvents.length === 1 ? '' : 's'}`
                : activeCount === 0
                  ? 'No tienes eventos activos'
                  : `${activeCount} evento${activeCount === 1 ? '' : 's'} activo${activeCount === 1 ? '' : 's'} · mantén presionado para archivar`}
          </Text>
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              {view === 'archived'
                ? 'No tienes eventos archivados.'
                : query.trim() !== ''
                  ? 'Ningún evento coincide con tu búsqueda.'
                  : 'Aún no tienes eventos asignados. Cuando el coordinador te asigne a un lugar de entrega aparecerán acá.'}
            </Text>
            {view === 'active' && query.trim() === '' && (
              <View style={{ marginTop: spacing.md }}>
                <Button
                  label="Refrescar"
                  variant="secondary"
                  onPress={() => void load()}
                />
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const isCompleted =
            item.status === 'completed' ||
            item.status === 'archived' ||
            (item.type === 'A' &&
              item.totalBeneficiaries > 0 &&
              item.totalDelivered >= item.totalBeneficiaries);
          return (
            <Pressable
              onPress={() => {
                router.push(`/event/${item.id}` as never);
              }}
              onLongPress={() => onLongPressEvent(item)}
              delayLongPress={350}
              style={({ pressed }) => [
                styles.eventCard,
                pressed && { opacity: 0.85 },
              ]}
            >
              <View style={styles.eventHeader}>
                <Text style={styles.eventName} numberOfLines={2}>
                  {item.name}
                </Text>
                <View
                  style={[
                    styles.statusChip,
                    {
                      backgroundColor: isCompleted
                        ? colors.successBg
                        : item.status === 'active'
                          ? colors.successBg
                          : item.status === 'draft'
                            ? colors.warningBg
                            : colors.bgInput,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      {
                        color: isCompleted
                          ? colors.success
                          : item.status === 'active'
                            ? colors.success
                            : item.status === 'draft'
                              ? colors.warning
                              : colors.textMuted,
                      },
                    ]}
                  >
                    {isCompleted
                      ? '✓ Completado'
                      : item.status === 'active'
                        ? 'Activo'
                        : item.status === 'draft'
                          ? 'Borrador'
                          : item.status}
                  </Text>
                </View>
              </View>

              <Text style={styles.eventLocation}>
                {item.municipio} ·{' '}
                {item.type === 'A' ? 'Tipo A · lista' : 'Tipo B · auto-registro'}
              </Text>

              {/* Fechas (M3) */}
              <Text style={styles.eventDate}>
                {formatEventDateRange(item.startDate, item.endDate)}
              </Text>

              <View style={styles.eventStats}>
                <View>
                  <Text style={styles.statLabel}>Total</Text>
                  <Text style={styles.statValue}>{item.totalBeneficiaries}</Text>
                </View>
                <View>
                  <Text style={styles.statLabel}>Entregadas</Text>
                  <Text style={[styles.statValue, { color: colors.success }]}>
                    {item.totalDelivered}
                  </Text>
                </View>
                <View style={{ flex: 1 }} />
                <Text style={styles.eventCta}>
                  {isCompleted ? 'Ver →' : 'Abrir →'}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

/**
 * Formatea el rango de fechas del evento en lenguaje natural.
 * Ejemplos:
 *   - "Hoy y mañana"
 *   - "Hoy · termina hoy"
 *   - "En 3 días — 12 al 14 may"
 *   - "Del 12 al 14 may 2026"
 *   - "Terminó hace 2 días"
 */
function formatEventDateRange(startStr: string, endStr: string): string {
  const start = new Date(startStr);
  const end = new Date(endStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDay = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const ms = 24 * 60 * 60 * 1000;
  const daysToStart = Math.round((startDay.getTime() - today.getTime()) / ms);
  const daysSinceEnd = Math.round((today.getTime() - endDay.getTime()) / ms);

  const fmtDay = (d: Date) =>
    d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  const sameDay = startDay.getTime() === endDay.getTime();
  const sameYear = start.getFullYear() === end.getFullYear();

  // Ya terminó
  if (daysSinceEnd > 0) {
    if (daysSinceEnd === 1) return 'Terminó ayer';
    if (daysSinceEnd < 30) return `Terminó hace ${daysSinceEnd} días`;
    return `Terminó el ${fmtDay(end)} ${end.getFullYear()}`;
  }

  // En curso
  if (daysToStart <= 0 && daysSinceEnd <= 0) {
    if (sameDay) return 'Hoy';
    return `En curso · termina ${fmtDay(end)}`;
  }

  // Futuro
  if (daysToStart === 1) {
    return sameDay ? 'Mañana' : `Mañana — ${fmtDay(end)}`;
  }
  if (daysToStart <= 7) {
    return sameDay
      ? `En ${daysToStart} días`
      : `En ${daysToStart} días — ${fmtDay(start)} al ${fmtDay(end)}`;
  }
  if (sameDay) {
    return `${fmtDay(start)}${sameYear ? '' : ' ' + start.getFullYear()}`;
  }
  return `Del ${fmtDay(start)} al ${fmtDay(end)}${
    sameYear ? ' ' + end.getFullYear() : ''
  }`;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  greeting: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  name: {
    color: colors.textPrimary,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
  },
  tenant: {
    color: colors.cyan,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    marginTop: 2,
  },
  errorBanner: {
    backgroundColor: colors.warningBg,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radii.sm,
  },
  errorText: {
    color: colors.warning,
    fontSize: fontSizes.sm,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgInput,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    paddingVertical: spacing.sm,
  },
  searchClear: {
    paddingLeft: spacing.sm,
    paddingVertical: spacing.xs,
  },
  searchClearText: {
    color: colors.textMuted,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.bold,
  },
  listContent: {
    padding: spacing.lg,
    flexGrow: 1,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  emptyCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  eventCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  eventName: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.bold,
    flex: 1,
  },
  statusChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  statusText: {
    fontSize: 10,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  eventLocation: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    marginTop: spacing.xs,
  },
  eventDate: {
    color: colors.cyan,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    marginTop: 4,
  },
  sortRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  sortChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgInput,
  },
  sortChipActive: {
    borderColor: colors.cyan,
    backgroundColor: colors.bgCard,
  },
  sortChipText: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
  },
  sortChipTextActive: {
    color: colors.cyan,
  },
  eventStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: fontWeights.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
    fontVariant: ['tabular-nums'],
  },
  eventCta: {
    color: colors.cyan,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.bold,
  },
});
