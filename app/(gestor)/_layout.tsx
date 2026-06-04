/**
 * Layout del grupo (gestor) — auth guard.
 *
 * Si el operador no está autenticado, redirige a login. Si está autenticado
 * pero su rol no es gestor/asistente, también lo bloquea (la app es solo
 * para roles de campo).
 */

import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useAuthStore } from '../../lib/stores/auth-store';
import { colors } from '../../lib/theme/tokens';
import { ConnectivityBar } from '../../components/ConnectivityBar';

const FIELD_ROLES = ['gestor', 'asistente'];

export default function GestorLayout() {
  const router = useRouter();
  const hydrated = useAuthStore((s) => s.hydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!hydrated) return;
    if (!isAuthenticated || !user) {
      router.replace('/login');
      return;
    }
    if (!FIELD_ROLES.includes(user.role)) {
      // Rol no apto para campo — kick out
      void useAuthStore.getState().logout();
      router.replace('/login');
    }
  }, [hydrated, isAuthenticated, user, router]);

  if (!hydrated || !isAuthenticated) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.cyan} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bgPrimary },
        }}
      />
      {/* Indicador de conectividad flotante (offline / reconexión) */}
      <ConnectivityBar />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgPrimary,
  },
});
