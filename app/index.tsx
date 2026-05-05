/**
 * Index — redirige según estado de autenticación.
 * Se monta UNA vez al abrir la app. Después el routing toma el control.
 */

import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthStore } from '../lib/stores/auth-store';
import { colors } from '../lib/theme/tokens';

export default function Index() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!hydrated) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.cyan} size="large" />
      </View>
    );
  }

  if (isAuthenticated) {
    // /inicio es el tab principal post-Sprint 9.6. Cast as never porque
    // el .expo/types/router.d.ts solo se regenera al correr expo start.
    return <Redirect href={'/inicio' as never} />;
  }
  return <Redirect href="/login" />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgPrimary,
  },
});
