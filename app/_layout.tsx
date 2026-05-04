/**
 * Root layout — punto de entrada con expo-router.
 *
 * Aquí:
 *   - Mount inicial: hidratamos el auth-store llamando /auth/me con el
 *     token guardado en SecureStore. Si OK → user en memoria. Si 401 →
 *     no autenticado, login screen.
 *   - StatusBar dark (la app es dark mode siempre).
 *   - Splash screen prevenir hide hasta hidrate completo.
 */

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '../lib/stores/auth-store';
import { colors } from '../lib/theme/tokens';

// Mantener splash visible hasta que terminemos hydrate
SplashScreen.preventAutoHideAsync().catch(() => null);

export default function RootLayout() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const hydrated = useAuthStore((s) => s.hydrated);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated) {
      SplashScreen.hideAsync().catch(() => null);
    }
  }, [hydrated]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor={colors.bgPrimary} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bgPrimary },
            animation: 'fade',
          }}
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
