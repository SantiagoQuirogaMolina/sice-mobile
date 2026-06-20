/**
 * ConnectivityBar — indicador de conectividad + sync para el gestor en campo.
 *
 * Detección ROBUSTA (no usa `isInternetReachable`, que da falso-negativo conocido
 * en redes móviles/captive portals → decía "offline" con internet real):
 *   - Señal primaria: `state.isConnected === true`.
 *   - Health-check real a NUESTRO backend (`GET /api/v1/health`, público) para
 *     distinguir "sin internet" de "backend sin responder" (Railway cold-start).
 *
 * Auto-sync: al RECUPERAR red dispara el drain SIEMPRE (sin gate por
 * hasAnyPending, que omitía items en backoff/blocked). El HTTP decide; si no
 * hay nada, es inocuo. El banner refleja el resultado del sync (no la ilusión
 * de éxito de ocultarse a los 2.5s pase lo que pase).
 *
 * Es `pointerEvents="none"`: solo informa, nunca bloquea toques del contenido.
 */

import NetInfo from '@react-native-community/netinfo';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontSizes, fontWeights, spacing } from '../lib/theme/tokens';
import { processSyncQueue, subscribeQueueEvents } from '../lib/sync/queue';
import { api } from '../lib/api/client';

type SyncFlash = { kind: 'syncing' } | { kind: 'ok'; n: number } | { kind: 'issues' } | null;
type Tone = 'offline' | 'warn' | 'sync' | 'ok';

export function ConnectivityBar() {
  const insets = useSafeAreaInsets();
  const [net, setNet] = useState(true); // isConnected — señal PRIMARIA
  const [backendAlive, setBackendAlive] = useState(true);
  const [showReconnected, setShowReconnected] = useState(false);
  const [syncFlash, setSyncFlash] = useState<SyncFlash>(null);
  const netRef = useRef(true);
  const wasOffline = useRef(false);
  const reconnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ping liviano a NUESTRO backend. skipAuth (público) + noQuickRetry (detectar
  // rápido "caído") + timeout corto. Distingue "sin internet" de "backend caído".
  const checkBackend = async (): Promise<void> => {
    try {
      await api.get('/api/v1/health', { skipAuth: true, noQuickRetry: true, timeoutMs: 5000 });
      setBackendAlive(true);
    } catch {
      setBackendAlive(false);
    }
  };

  // Feedback del sync en el banner (no la ilusión de "ya subió todo").
  useEffect(() => {
    const unsub = subscribeQueueEvents((e) => {
      if (e.type === 'batch-start') {
        if (e.total > 0) {
          if (flashTimer.current) clearTimeout(flashTimer.current);
          setSyncFlash({ kind: 'syncing' });
        }
      } else if (e.type === 'batch-end') {
        if (flashTimer.current) clearTimeout(flashTimer.current);
        if (e.processed === 0 && e.ok === 0) {
          setSyncFlash(null); // no había nada que subir → no molestar
        } else if (e.failed === 0 && e.blocked === 0) {
          setSyncFlash({ kind: 'ok', n: e.ok });
          flashTimer.current = setTimeout(() => setSyncFlash(null), 2500);
        } else {
          setSyncFlash({ kind: 'issues' });
          flashTimer.current = setTimeout(() => setSyncFlash(null), 4500);
        }
      }
    });
    return () => {
      unsub();
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  // NetInfo (conectividad) + health-check periódico + auto-sync al reconectar.
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true; // PRIMARIA (no isInternetReachable)
      netRef.current = online;
      setNet(online);
      if (online && wasOffline.current) {
        setShowReconnected(true);
        if (reconnTimer.current) clearTimeout(reconnTimer.current);
        reconnTimer.current = setTimeout(() => setShowReconnected(false), 2500);
        void checkBackend();
        void processSyncQueue(); // SIEMPRE (sin gate): el HTTP decide; inocuo si vacío
      }
      wasOffline.current = !online;
    });
    void checkBackend(); // ping inmediato al montar
    const iv = setInterval(() => {
      if (netRef.current) void checkBackend();
    }, 30000);
    return () => {
      unsub();
      clearInterval(iv);
      if (reconnTimer.current) clearTimeout(reconnTimer.current);
    };
  }, []);

  // Prioridad del banner: offline > sincronizando > backend-caído > resultado > reconectó.
  let text: string | null = null;
  let tone: Tone = 'ok';
  if (!net) {
    text = 'Sin conexión · trabajando offline';
    tone = 'offline';
  } else if (syncFlash?.kind === 'syncing') {
    text = 'Sincronizando…';
    tone = 'sync';
  } else if (!backendAlive) {
    text = 'Servidor sin respuesta · reintentando…';
    tone = 'warn';
  } else if (syncFlash?.kind === 'ok') {
    text = `✓ ${syncFlash.n} sincronizado${syncFlash.n === 1 ? '' : 's'}`;
    tone = 'ok';
  } else if (syncFlash?.kind === 'issues') {
    text = 'Sync incompleto · abre Sincronización';
    tone = 'warn';
  } else if (showReconnected) {
    text = 'Conexión restablecida';
    tone = 'ok';
  }

  if (!text) return null;

  const toneBg: Record<Tone, string> = {
    offline: 'rgba(245,158,11,0.22)',
    warn: 'rgba(245,158,11,0.22)',
    sync: 'rgba(0,212,255,0.20)',
    ok: 'rgba(34,197,94,0.22)',
  };
  const toneDot: Record<Tone, string> = {
    offline: '#f59e0b',
    warn: '#f59e0b',
    sync: colors.cyan,
    ok: '#22c55e',
  };

  return (
    <View
      pointerEvents="none"
      style={[styles.bar, { paddingTop: insets.top + spacing.xs, backgroundColor: toneBg[tone] }]}
    >
      <View style={[styles.dot, { backgroundColor: toneDot[tone] }]} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    color: colors.textPrimary,
  },
});
