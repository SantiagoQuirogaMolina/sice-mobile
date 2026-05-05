/**
 * Inicio — lista de eventos asignados al operador.
 *
 * Tab principal del operador. Antes era /dashboard; con el TabBar
 * (Sprint 9.6) pasó a ser /inicio. El logout y el perfil migraron a la
 * tab "Yo" para no congestionar el header.
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '../../../components/Screen';
import { Button } from '../../../components/Button';
import { useAuthStore } from '../../../lib/stores/auth-store';
import {
  eventsService,
  type EventSummary,
} from '../../../lib/api/services/events.service';
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from '../../../lib/theme/tokens';

export default function InicioTab() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const items = await eventsService.listForMe();
      const usable = items.filter(
        (e) =>
          e.status === 'active' || e.status === 'paused' || e.status === 'draft',
      );
      setEvents(usable);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error desconocido';
      setError(
        msg.includes('NETWORK_ERROR')
          ? 'Sin conexión al servidor. Mostrando datos guardados.'
          : msg,
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    void load();
  };

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

      <FlatList
        data={events}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.listContent}
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
            {events.length === 0
              ? 'No tienes eventos asignados'
              : `${events.length} evento${events.length === 1 ? '' : 's'} activo${events.length === 1 ? '' : 's'}`}
          </Text>
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              Aún no tienes eventos asignados. Cuando el coordinador te asigne
              a un sector aparecerán acá.
            </Text>
            <View style={{ marginTop: spacing.md }}>
              <Button
                label="Refrescar"
                variant="secondary"
                onPress={() => void load()}
              />
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              router.push(`/event/${item.id}` as never);
            }}
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
                    backgroundColor:
                      item.status === 'active'
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
                      color:
                        item.status === 'active'
                          ? colors.success
                          : item.status === 'draft'
                            ? colors.warning
                            : colors.textMuted,
                    },
                  ]}
                >
                  {item.status === 'active'
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
              <Text style={styles.eventCta}>Abrir →</Text>
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
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
