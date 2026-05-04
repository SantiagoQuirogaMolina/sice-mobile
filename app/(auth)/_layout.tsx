/**
 * Layout del grupo (auth) — sin guard. Si el usuario YA está autenticado y
 * navega aquí (ej: tras logout), igual deja entrar.
 */

import { Stack } from 'expo-router';
import { colors } from '../../lib/theme/tokens';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bgPrimary },
      }}
    />
  );
}
