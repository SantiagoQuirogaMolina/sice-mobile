/**
 * Index — redirige según estado de autenticación + gate biométrico.
 * Se monta UNA vez al abrir la app. Si el usuario activó desbloqueo biométrico
 * y aún no desbloqueó en esta apertura, mostramos el lock (huella/Face ID)
 * antes de entrar a la app.
 */

import * as React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthStore } from '../lib/stores/auth-store';
import { authenticate } from '../lib/biometric';
import { colors, fontSizes, fontWeights, radii, spacing } from '../lib/theme/tokens';

export default function Index() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const biometricUnlocked = useAuthStore((s) => s.biometricUnlocked);

  if (!hydrated) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.cyan} size="large" />
      </View>
    );
  }

  if (isAuthenticated) {
    // Gate biométrico: si activó huella y no ha desbloqueado en esta apertura,
    // pedimos biometría antes de entrar.
    if (biometricEnabled && !biometricUnlocked) {
      return <BiometricLock />;
    }
    return <Redirect href={'/inicio' as never} />;
  }
  return <Redirect href="/login" />;
}

function BiometricLock() {
  const setBiometricUnlocked = useAuthStore((s) => s.setBiometricUnlocked);
  const logout = useAuthStore((s) => s.logout);
  const [trying, setTrying] = React.useState(false);

  const tryUnlock = React.useCallback(async () => {
    setTrying(true);
    const ok = await authenticate('Desbloquea SICE para continuar');
    setTrying(false);
    if (ok) setBiometricUnlocked(true);
  }, [setBiometricUnlocked]);

  // Lanzar el prompt automáticamente al abrir la app.
  React.useEffect(() => {
    void tryUnlock();
  }, [tryUnlock]);

  return (
    <View style={styles.center}>
      <Text style={styles.lockEmoji}>🔒</Text>
      <Text style={styles.lockTitle}>SICE bloqueado</Text>
      <Text style={styles.lockSub}>
        Desbloquea con tu huella o rostro para continuar.
      </Text>
      <Pressable
        style={[styles.unlockBtn, trying && styles.unlockBtnDisabled]}
        onPress={() => void tryUnlock()}
        disabled={trying}
      >
        <Text style={styles.unlockBtnText}>
          {trying ? 'Verificando…' : 'Desbloquear'}
        </Text>
      </Pressable>
      <Pressable onPress={() => void logout()} style={styles.logoutLink}>
        <Text style={styles.logoutLinkText}>Cerrar sesión</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgPrimary,
    padding: spacing.xl,
  },
  lockEmoji: { fontSize: 48, marginBottom: spacing.lg },
  lockTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.extrabold,
    marginBottom: spacing.sm,
  },
  lockSub: {
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 20,
  },
  unlockBtn: {
    backgroundColor: colors.cyan,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
  },
  unlockBtnDisabled: { opacity: 0.6 },
  unlockBtnText: {
    color: '#0D1B2A',
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.bold,
  },
  logoutLink: { marginTop: spacing.lg },
  logoutLinkText: { color: colors.textMuted, fontSize: fontSizes.sm },
});
