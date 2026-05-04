/**
 * Detalle del evento — placeholder Sprint 9.0.
 *
 * Sprint siguiente construirá:
 *   - KPIs reales del operador (entregadas hoy, pendientes, sin sync)
 *   - Lista de beneficiarios con búsqueda offline (SQLite)
 *   - CTA "Capturar entrega" → wizard
 *   - CTA "Registrar excepción" (si Tipo A allowExceptions)
 *   - Banner offline si no hay red
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../../../../components/Screen';
import { Button } from '../../../../components/Button';
import {
  eventsService,
  type EventSummary,
} from '../../../../lib/api/services/events.service';
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    void eventsService.getById(id).then((e) => {
      setEvent(e);
      setLoading(false);
    });
  }, [id]);

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

  return (
    <Screen>
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

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sprint 9.0 — Scaffold</Text>
        <Text style={styles.cardBody}>
          La estructura base ya está conectada al backend. En el siguiente
          sprint agregamos:
        </Text>
        <View style={styles.bullet}>
          <Text style={styles.bulletText}>• Lista de beneficiarios (SQLite offline)</Text>
        </View>
        <View style={styles.bullet}>
          <Text style={styles.bulletText}>• Wizard de captura (firma + foto + GPS)</Text>
        </View>
        <View style={styles.bullet}>
          <Text style={styles.bulletText}>• Sync queue confiable</Text>
        </View>
        <View style={styles.bullet}>
          <Text style={styles.bulletText}>• Excepciones offline</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Total</Text>
          <Text style={styles.statValue}>{event.totalBeneficiaries}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Entregadas</Text>
          <Text style={[styles.statValue, { color: colors.success }]}>
            {event.totalDelivered}
          </Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Estado</Text>
          <Text style={[styles.statValue, { fontSize: fontSizes.md }]}>
            {event.status}
          </Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  },
  card: {
    marginTop: spacing.lg,
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cyan,
  },
  cardTitle: {
    color: colors.cyan,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardBody: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  bullet: {
    marginTop: spacing.sm,
  },
  bulletText: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
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
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
    marginTop: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
  errorText: {
    color: colors.error,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
  },
});
