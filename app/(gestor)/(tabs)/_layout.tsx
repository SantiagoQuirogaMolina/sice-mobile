/**
 * Tab navigator del operador (Inicio · Sync · Yo).
 *
 * Las pantallas dentro de (tabs) muestran este TabBar inferior. Pantallas
 * fuera del grupo — event/[id]/* — usan Stack normal sin tabs (foco
 * full-screen para captura, etc.).
 *
 * Sprint 9.6: introducimos navegación por tabs porque el back stack se
 * apilaba con cada captura. Ahora el operador siempre puede saltar entre
 * Inicio / Sync / Yo en un tap, sin importar dónde esté.
 */

import { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { hasAnyPending, subscribeQueueEvents } from '../../../lib/sync/queue';
import {
  colors,
  fontSizes,
  fontWeights,
} from '../../../lib/theme/tokens';

export default function TabsLayout() {
  // Badge en el tab Sync — refleja si hay deliveries / excepciones pendientes
  // de cualquier evento. Recalcula cada vez que la cola emite un evento.
  const [hasPending, setHasPending] = useState<boolean>(() => hasAnyPending());

  useEffect(() => {
    const refresh = () => setHasPending(hasAnyPending());
    refresh();
    const unsub = subscribeQueueEvents(refresh);
    // Polling barato para detectar nuevas pending creadas por el usuario en
    // otra pantalla (ej. tras una captura). 2s de cadencia — el TabBar no
    // tiene UI animada, no satura.
    const id = setInterval(refresh, 2000);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, []);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bgCard,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 64,
          paddingTop: 6,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: colors.cyan,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: {
          fontSize: fontSizes.xs,
          fontWeight: fontWeights.semibold,
        },
      }}
    >
      <Tabs.Screen
        name="inicio"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="sync"
        options={{
          title: 'Sync',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="sync-outline" size={size} color={color} />
          ),
          tabBarBadge: hasPending ? '' : undefined,
          tabBarBadgeStyle: {
            backgroundColor: colors.error,
            minWidth: 8,
            maxWidth: 8,
            height: 8,
            borderRadius: 4,
            transform: [{ translateY: -2 }],
          },
        }}
      />
      <Tabs.Screen
        name="yo"
        options={{
          title: 'Yo',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
