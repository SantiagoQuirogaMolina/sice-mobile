/**
 * ConnectivityBar — indicador de conectividad para el gestor en campo.
 *
 * Escucha el estado de red con NetInfo y muestra un banner flotante (overlay)
 * en el borde superior:
 *   - OFFLINE  → barra ámbar "Sin conexión · trabajando offline" (persistente).
 *   - RECONECTÓ → barra verde "Conexión restablecida" unos segundos y se oculta.
 *   - ONLINE estable → no se renderiza (no roba espacio ni molesta).
 *
 * La app es offline-first: este indicador solo INFORMA; la captura sigue
 * funcionando sin red y sincroniza al volver. Es `pointerEvents="none"` para
 * no bloquear toques del contenido debajo.
 */

import NetInfo from '@react-native-community/netinfo';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontSizes, fontWeights, spacing } from '../lib/theme/tokens';

export function ConnectivityBar() {
  const insets = useSafeAreaInsets();
  const [online, setOnline] = useState(true);
  const [showReconnected, setShowReconnected] = useState(false);
  const wasOffline = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      // isInternetReachable puede ser null (aún desconocido) → lo tratamos como
      // online para no falsear "sin conexión" en el arranque.
      const isOnline =
        state.isConnected !== false && state.isInternetReachable !== false;
      setOnline(isOnline);
      if (isOnline && wasOffline.current) {
        setShowReconnected(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setShowReconnected(false), 2500);
      }
      wasOffline.current = !isOnline;
    });
    return () => {
      unsub();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (online && !showReconnected) return null;

  const offline = !online;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.bar,
        { paddingTop: insets.top + spacing.xs },
        offline ? styles.offline : styles.online,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: offline ? '#f59e0b' : '#22c55e' }]} />
      <Text style={styles.text}>
        {offline ? 'Sin conexión · trabajando offline' : 'Conexión restablecida'}
      </Text>
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
  offline: { backgroundColor: 'rgba(245,158,11,0.22)' },
  online: { backgroundColor: 'rgba(34,197,94,0.22)' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    color: colors.textPrimary,
  },
});
