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
  Modal,
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
import { DownloadProgress } from '../../../../components/DownloadProgress';
import {
  eventsService,
  type EventSummary,
} from '../../../../lib/api/services/events.service';
import { beneficiariesService } from '../../../../lib/api/services/beneficiaries.service';
import { apiErrorMessage } from '../../../../lib/api/error-message';
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
  const [loadedCount, setLoadedCount] = useState(0);
  const [instanceBusy, setInstanceBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | 'new' | 'close'>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<EventSummary[]>([]);
  const SESSIONS_PAGE = 5;
  const [sessionsShown, setSessionsShown] = useState(SESSIONS_PAGE);

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

      // 1b. Si es parte de una serie, traer el historial de sesiones (red, best-effort).
      if (ev?.seriesId) {
        eventsService
          .listInstances(ev.seriesId)
          .then(setSessions)
          .catch(() => {
            /* sin red: se mantiene lo que haya */
          });
      }

      // 2. Mostrar el dashboard YA con lo cacheado (no bloquear en la descarga).
      //    Si no hay nada cacheado todavía, dejamos el progreso visible.
      refreshLocalCounts();
      if (getEventCounts(id).total > 0) setLoading(false);

      // 3. Descargar/actualizar TODA la lista en segundo plano (con progreso).
      try {
        await beneficiariesService.listForEvent(id, (n) => setLoadedCount(n));
        setBannerError(null);
      } catch (e) {
        setBannerError(
          apiErrorMessage(
            e,
            'No se pudo actualizar la lista. Mostrando datos guardados.',
          ),
        );
      }

      // 4. Re-leer counts del SQLite (ahora completos)
      refreshLocalCounts();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Crea la nueva sesión (instancia). Requiere red; copia la lista del programa.
  const runNewInstance = async () => {
    setConfirm(null);
    setInstanceBusy(true);
    try {
      const inst = await eventsService.createInstance(id);
      router.replace(`/event/${inst.id}` as never);
    } catch (e) {
      setBannerError(apiErrorMessage(e, 'No se pudo crear la sesión. Revisa tu conexión.'));
    } finally {
      setInstanceBusy(false);
    }
  };

  // Cierra la sesión al terminar de llenar la planilla. Requiere red.
  const runCloseInstance = async () => {
    setConfirm(null);
    setInstanceBusy(true);
    try {
      await eventsService.closeInstance(id);
      await load();
    } catch (e) {
      setBannerError(apiErrorMessage(e, 'No se pudo cerrar la sesión. Revisa tu conexión.'));
    } finally {
      setInstanceBusy(false);
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
        <DownloadProgress count={loadedCount} />
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

  // Estado del evento en el contexto de SERIE recurrente.
  //  - eventClosed: el coordinador cerró el evento (acción manual, web).
  //  - listFullyDelivered: solo aplica si NO es serie. En una serie con clases
  //    recurrentes, llenar la planilla del primer día NO significa que la
  //    serie terminó — solo significa que ese día asistieron todos.
  //  - isOrigin: el evento es el PROGRAMA ORIGEN (pos=1 o sin serie).
  //  - lastActiveSession: la sesión con mayor seriesPosition que sigue abierta.
  //  - isHistorical: estamos en una sesión vieja (no la última) → solo lectura.
  //  - programWithChildren: estamos en el programa origen y ya hay sesiones —
  //    las capturas nuevas van a la sesión actual, NO al programa origen.
  //  - canCapture: puedo capturar AQUÍ ahora mismo.
  //  - canCreateSession: puedo abrir una sesión nueva DESDE aquí.
  const eventClosed = event.status === 'completed' || event.status === 'archived';
  const isSeriesMember = !!event.seriesId;
  const seriesPos = event.seriesPosition ?? (isSeriesMember ? 1 : null);
  const isOrigin = !isSeriesMember || seriesPos === 1;
  const lastActiveSession = sessions
    .filter((s) => s.status === 'active' || s.status === 'paused')
    .reduce<EventSummary | null>(
      (acc, s) => (!acc || (s.seriesPosition ?? 0) > (acc.seriesPosition ?? 0) ? s : acc),
      null,
    );
  const programWithChildren = isOrigin && sessions.length > 1;
  const isHistorical =
    isSeriesMember && lastActiveSession !== null && event.id !== lastActiveSession.id;
  const listFullyDelivered =
    !isSeriesMember && event.type === 'A' && counts.total > 0 && counts.pending === 0;
  const isCompleted = eventClosed || listFullyDelivered;
  const canCapture = !isDraft && !isCompleted && !programWithChildren && !isHistorical;
  const canCreateSession =
    !!event.allowOperatorInstances && !eventClosed && !isDraft && isOrigin;

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

        {/* Etiqueta de contexto en serie: distingue programa origen, sesión
            cerrada (histórico) o sesión actual — clave para que el operador
            sepa dónde está capturando. */}
        {isSeriesMember && (
          <View
            style={[
              styles.contextBadge,
              {
                backgroundColor:
                  programWithChildren || isHistorical
                    ? 'rgba(255,255,255,0.06)'
                    : colors.successBg,
                borderColor:
                  programWithChildren || isHistorical ? colors.border : colors.success,
              },
            ]}
          >
            <Text
              style={[
                styles.contextBadgeText,
                {
                  color:
                    programWithChildren || isHistorical
                      ? colors.textSecondary
                      : colors.success,
                },
              ]}
            >
              {programWithChildren
                ? `Programa origen · ${sessions.length} sesiones`
                : isHistorical
                  ? `Sesión ${seriesPos} · cerrada (histórico)`
                  : isOrigin
                    ? 'Programa origen'
                    : `Sesión ${seriesPos} · en curso`}
            </Text>
          </View>
        )}

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

        {/* Banner contextual: evento cerrado, lista completada, programa con
            sesiones (captura va en la sesión actual) o sesión histórica. */}
        {!isDraft && eventClosed && (
          <View style={styles.successBanner}>
            <Text style={styles.successTitle}>✓ Evento cerrado</Text>
            <Text style={styles.successBody}>
              El coordinador cerró este evento. Ya no puedes capturar nuevas
              entregas, pero puedes consultar tus registros.
            </Text>
          </View>
        )}
        {!isDraft && !eventClosed && listFullyDelivered && (
          <View style={styles.successBanner}>
            <Text style={styles.successTitle}>✓ Lista completada</Text>
            <Text style={styles.successBody}>
              Ya entregaste a todos los beneficiarios de tu lista. Si necesitas
              revisar algún registro, ábrelo desde la lista.
            </Text>
          </View>
        )}
        {!isDraft && !eventClosed && programWithChildren && (
          <View style={styles.softBanner}>
            <Text style={styles.softBannerText}>
              Programa origen. La captura del día ocurre en la sesión actual.
              Solo el coordinador puede cerrar el programa.
            </Text>
          </View>
        )}
        {!isDraft && !eventClosed && isHistorical && (
          <View style={styles.softBanner}>
            <Text style={styles.softBannerText}>
              Sesión {seriesPos} · cerrada al abrir una nueva. Esta vista es
              solo de consulta; la captura ocurre en la sesión actual.
            </Text>
          </View>
        )}

        {/* Banner refresh fallido */}
        {bannerError && (
          <View style={styles.softBanner}>
            <Text style={styles.softBannerText}>{bannerError}</Text>
          </View>
        )}

        {/* Indicador: la lista ya está descargada y disponible sin conexión. */}
        {counts.total > 0 && (
          <View style={styles.offlineChip}>
            <Text style={styles.offlineChipText}>
              ✓ Disponible sin conexión · {counts.total.toLocaleString('es-CO')} en este
              dispositivo
            </Text>
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
          ) : canCapture ? (
            event.type === 'B' ? (
              <Button
                label="Añadir registro"
                variant="primary"
                onPress={() => router.push(`/event/${event.id}/new` as never)}
              />
            ) : (
              <Button
                label="Capturar entrega"
                variant="primary"
                onPress={() => router.push(`/event/${event.id}/beneficiaries` as never)}
              />
            )
          ) : (
            // No se captura aquí: vista de consulta. Aplica a evento cerrado,
            // lista completada, programa con sesiones y sesiones históricas.
            <Button
              label={event.type === 'B' ? 'Ver registros' : 'Ver mis registros'}
              variant="primary"
              onPress={() => router.push(`/event/${event.id}/beneficiaries` as never)}
            />
          )}
          {canCapture && (
            <>
              <View style={{ height: spacing.sm }} />
              <Button
                label={
                  event.type === 'B'
                    ? 'Ver lista de registros'
                    : 'Ver lista de beneficiarios'
                }
                variant="secondary"
                onPress={() => router.push(`/event/${event.id}/beneficiaries` as never)}
              />
            </>
          )}
          {/* Excepciones: solo si capturamos aquí y el evento las permite. */}
          {canCapture && event.allowExceptions && (
            <View style={{ marginTop: spacing.sm }}>
              <Button
                label="+ Registrar excepción"
                variant="secondary"
                onPress={() => router.push(`/event/${event.id}/exception` as never)}
              />
            </View>
          )}
          {/* + Nueva sesión: solo desde el programa origen o desde la sesión
              actual (en curso). Las sesiones cerradas no la muestran. */}
          {canCreateSession && (
            <View style={{ marginTop: spacing.sm }}>
              <Button
                label={instanceBusy ? 'Creando sesión…' : '+ Nueva sesión'}
                variant="primary"
                onPress={() => setConfirm('new')}
              />
            </View>
          )}
          {/* Cerrar sesión: solo si estamos en la sesión actual (instancia
              pos>1, status active) — el cierre del programa lo hace el
              coordinador desde la web. */}
          {!isOrigin &&
            event.status === 'active' &&
            lastActiveSession !== null &&
            event.id === lastActiveSession.id && (
              <View style={{ marginTop: spacing.sm }}>
                <Button
                  label={instanceBusy ? 'Cerrando…' : 'Cerrar sesión'}
                  variant="secondary"
                  onPress={() => setConfirm('close')}
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

        {/* Historial de sesiones: ordenado de MÁS RECIENTE a más antigua, paginado
            (las recientes primero — útiles; las antiguas a "Ver más"). Evita listas
            enormes en programas con 100+ sesiones. */}
        {sessions.length > 1 &&
          (() => {
            const sorted = [...sessions].sort(
              (a, b) => (b.seriesPosition ?? 0) - (a.seriesPosition ?? 0),
            );
            const visible = sorted.slice(0, sessionsShown);
            const remaining = sorted.length - visible.length;
            return (
              <View style={styles.infoCard}>
                <Text style={styles.infoTitle}>
                  Sesiones del programa ({sessions.length})
                </Text>
                {visible.map((s) => {
                  const isCurrent = s.id === id;
                  const open = s.status === 'active' || s.status === 'paused';
                  return (
                    <Pressable
                      key={s.id}
                      disabled={isCurrent}
                      onPress={() => router.push(`/event/${s.id}` as never)}
                      style={({ pressed }) => [
                        styles.sessionRow,
                        pressed && !isCurrent && { opacity: 0.7 },
                      ]}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.sessionName} numberOfLines={1}>
                          Sesión {s.seriesPosition ?? 1}
                          {isCurrent ? ' · esta' : ''}
                        </Text>
                        <Text style={styles.sessionMeta} numberOfLines={1}>
                          {s.startDate.slice(0, 10)} · {s.totalDelivered}/
                          {s.totalBeneficiaries} asistieron
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.sessionBadge,
                          {
                            backgroundColor: open
                              ? colors.successBg
                              : 'rgba(255,255,255,0.06)',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.sessionBadgeText,
                            { color: open ? colors.success : colors.textMuted },
                          ]}
                        >
                          {open ? 'Abierta' : 'Cerrada'}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
                {remaining > 0 && (
                  <Pressable
                    onPress={() => setSessionsShown((n) => n + SESSIONS_PAGE)}
                    style={({ pressed }) => [
                      styles.sessionMore,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text style={styles.sessionMoreText}>
                      Ver {Math.min(remaining, SESSIONS_PAGE)} más
                      {remaining > SESSIONS_PAGE ? ` (de ${remaining})` : ''}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })()}

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

      {/* Modal de confirmación (Nueva sesión / Cerrar sesión) — estilizado,
          con copy para el operador (no menciona "cupo"). */}
      <Modal
        visible={confirm !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirm(null)}
      >
        <Pressable style={styles.confirmBackdrop} onPress={() => setConfirm(null)}>
          <Pressable style={styles.confirmCard} onPress={() => {}}>
            <Text style={styles.confirmTitle}>
              {confirm === 'new' ? 'Nueva sesión' : 'Cerrar sesión'}
            </Text>
            <Text style={styles.confirmBody}>
              {confirm === 'new'
                ? 'Se abrirá una sesión nueva (con la fecha de hoy) y la lista de beneficiarios, lista para tomar asistencia. La sesión anterior se cerrará automáticamente — solo queda abierta la última; su historial seguirá disponible.'
                : 'Se cerrará esta sesión. Ya no podrás registrar más asistencia en ella; quedará guardada en el historial.'}
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => setConfirm(null)}
                style={({ pressed }) => [styles.confirmCancel, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.confirmCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={confirm === 'new' ? runNewInstance : runCloseInstance}
                style={({ pressed }) => [styles.confirmOk, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.confirmOkText}>
                  {confirm === 'new' ? 'Crear sesión' : 'Cerrar sesión'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  offlineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.successBg,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginBottom: spacing.sm,
  },
  offlineChipText: {
    color: colors.success,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
  },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  confirmTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
    marginBottom: spacing.sm,
  },
  confirmBody: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  confirmCancel: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
  },
  confirmCancelText: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
  },
  confirmOk: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: colors.cyan,
  },
  confirmOkText: {
    color: colors.navyDark,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.bold,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sessionName: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
  },
  sessionMeta: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    marginTop: 2,
  },
  sessionBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.full,
  },
  sessionBadgeText: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
  },
  contextBadge: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  contextBadgeText: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
  },
  sessionMore: {
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  sessionMoreText: {
    color: colors.cyan,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
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
