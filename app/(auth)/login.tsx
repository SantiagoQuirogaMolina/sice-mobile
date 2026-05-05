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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { useAuthStore } from '../../lib/stores/auth-store';
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from '../../lib/theme/tokens';

/**
 * DEMO_OPERATORS — auto-fill rápido para los operadores seeded en el backend.
 * Espejo del flujo que tenemos en la web. Solo mostramos roles que pueden
 * usar la app móvil (gestor/asistente, ambos "operador de campo" tras Sprint 7).
 *
 * Sprint 9.7: BD reseteada — 4 operadores (2 por cada tenant: Tunja + Cómbita).
 * En producción real con un cliente final, esta sección se oculta.
 */
const DEMO_OPERATORS = [
  // Tunja
  {
    email: 'gestor1@tunja.gov.co',
    label: 'Andrés Pulido',
    sub: 'Tunja',
    initials: 'AP',
  },
  {
    email: 'gestor2@tunja.gov.co',
    label: 'María Cárdenas',
    sub: 'Tunja',
    initials: 'MC',
  },
  // Cómbita
  {
    email: 'gestor1@combita.gov.co',
    label: 'Jorge Buitrago',
    sub: 'Cómbita',
    initials: 'JB',
  },
  {
    email: 'gestor2@combita.gov.co',
    label: 'Patricia Vargas',
    sub: 'Cómbita',
    initials: 'PV',
  },
];

const DEMO_PASSWORD = 'demo123';

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
            <Text style={styles.logoText}>SICE</Text>
          </View>
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

        {/* Demo login chips — pre-llena email+pass de operadores seeded */}
        {__DEV__ && (
          <View style={styles.demoSection}>
            <Text style={styles.demoTitle}>Acceso rápido (demo)</Text>
            <Text style={styles.demoSubtitle}>
              Toca un operador para autollenar credenciales · contraseña{' '}
              <Text style={styles.demoMono}>demo123</Text>
            </Text>
            <View style={styles.chipsWrap}>
              {DEMO_OPERATORS.map((op) => (
                <Pressable
                  key={op.email}
                  onPress={() => {
                    setEmail(op.email);
                    setPassword(DEMO_PASSWORD);
                  }}
                  disabled={isLoading}
                  style={({ pressed }) => [
                    styles.chip,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View style={styles.chipAvatar}>
                    <Text style={styles.chipAvatarText}>{op.initials}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.chipLabel} numberOfLines={1}>
                      {op.label}
                    </Text>
                    <Text style={styles.chipSub} numberOfLines={1}>
                      {op.sub}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        )}

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
    backgroundColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logoText: {
    color: colors.navyDark,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.extrabold,
    letterSpacing: 1.5,
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
  demoSection: {
    marginTop: spacing.xl,
  },
  demoTitle: {
    color: colors.cyan,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  demoSubtitle: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  demoMono: {
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
    color: colors.cyan,
  },
  chipsWrap: {
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgCard,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  chipAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipAvatarText: {
    color: colors.cyan,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
  },
  chipLabel: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
  },
  chipSub: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    marginTop: 2,
  },
});
