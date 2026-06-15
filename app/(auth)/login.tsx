/**
 * Login screen — auth simple email + password para operadores de campo.
 *
 * Para gestores con 2FA / first-login forzado, los redirige a hacerlo desde
 * la web (raro para roles de campo). En sprint siguiente integramos esos
 * flows si es necesario.
 */

import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { SiceMark } from '../../components/SiceMark';
import { useAuthStore } from '../../lib/stores/auth-store';
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from '../../lib/theme/tokens';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const login = useAuthStore((s) => s.login);
  const isLoading = useAuthStore((s) => s.isLoading);
  const errorMessage = useAuthStore((s) => s.errorMessage);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) {
      // expo-router types se regeneran cuando arranca Metro. Hasta que corra,
      // /inicio (tab nuevo de Sprint 9.6) no está en el tipo. Cast as never.
      router.replace('/inicio' as never);
    }
  }, [isAuthenticated, router]);

  const canSubmit =
    email.trim().length > 3 && password.length >= 4 && !isLoading;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={styles.logoMark}>
            <SiceMark size={56} color={colors.cyan} clipFill={colors.navyDark} />
          </View>
          <Text style={styles.brandWord}>SICE</Text>
          <Text style={styles.brandTag}>SISTEMA INTEGRADO DE COBERTURA Y EFICIENCIA</Text>
          <Text style={styles.brandTitle}>Operador de campo</Text>
          <Text style={styles.brandSubtitle}>
            Captura entregas con firma, foto y GPS · funciona offline
          </Text>
        </View>

        <View style={styles.card}>
          <Input
            label="Correo"
            value={email}
            onChangeText={setEmail}
            placeholder="tu@entidad.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            editable={!isLoading}
          />

          <Input
            label="Contraseña"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            editable={!isLoading}
          />

          {errorMessage && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          <View style={{ marginTop: spacing.md }}>
            <Button
              label={isLoading ? 'Entrando…' : 'Entrar'}
              loading={isLoading}
              disabled={!canSubmit}
              onPress={() => void login(email, password)}
            />
          </View>
        </View>

        <Text style={styles.footer}>
          Si tu cuenta tiene 2FA o requiere cambio de contraseña, ingresa
          primero desde la web. Esta app es para uso en campo.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    justifyContent: 'center',
  },
  brand: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logoMark: {
    width: 64,
    height: 64,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  brandWord: {
    color: colors.textPrimary,
    fontSize: 32,
    fontWeight: fontWeights.extrabold,
    letterSpacing: -0.8, // Inter -0.025em equivalente a 32px
    lineHeight: 32,
    marginBottom: 4,
  },
  brandTag: {
    color: colors.textMuted,
    fontSize: 9.5,
    fontWeight: fontWeights.medium,
    letterSpacing: 1.7, // 0.18em a 9.5px
    textTransform: 'uppercase',
    marginBottom: spacing.md,
  },
  brandTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.extrabold,
  },
  brandSubtitle: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    textAlign: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  errorBanner: {
    backgroundColor: colors.errorBg,
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  errorText: {
    color: colors.error,
    fontSize: fontSizes.sm,
  },
  footer: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    textAlign: 'center',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
});
