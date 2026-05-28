/**
 * Yo — perfil del operador, info de la app, logout.
 *
 * Sprint 9.6: tab dedicada que reemplaza al botón "Salir" del header viejo.
 * Mostrar el avatar (iniciales), nombre, rol, tenant, email + version
 * de la app + botón logout con confirmación.
 *
 * Útil también como espacio de "ajustes" en el futuro: cambiar idioma,
 * limpiar cache local, ver TOS, etc.
 */

import { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { Screen } from '../../../components/Screen';
import { Button } from '../../../components/Button';
import { useAuthStore } from '../../../lib/stores/auth-store';
import {
  authenticate,
  isBiometricEnabled,
  isBiometricSupported,
  setBiometricEnabled,
} from '../../../lib/biometric';
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from '../../../lib/theme/tokens';

const ROLE_LABELS: Record<string, string> = {
  gestor: 'Gestor de campo',
  asistente: 'Asistente de campo',
  coordinator: 'Coordinador',
  super_admin: 'Super Admin',
  digitador: 'Digitador',
  auditor: 'Auditor',
  platform_admin: 'Platform Admin',
};

export default function YoTab() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const refreshBiometricEnabled = useAuthStore((s) => s.refreshBiometricEnabled);
  const [submitting, setSubmitting] = useState(false);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      setBioSupported(await isBiometricSupported());
      setBioEnabled(await isBiometricEnabled());
    })();
  }, []);

  const onToggleBiometric = async (next: boolean) => {
    setBioBusy(true);
    try {
      if (next) {
        // Confirmar con una autenticación real antes de activar.
        const ok = await authenticate(
          'Confirma tu huella para activar el desbloqueo',
        );
        if (!ok) return;
      }
      await setBiometricEnabled(next);
      setBioEnabled(next);
      await refreshBiometricEnabled();
    } finally {
      setBioBusy(false);
    }
  };

  const initials = (() => {
    const name = user?.fullName?.trim() ?? '';
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  })();

  const onLogout = () => {
    Alert.alert(
      'Cerrar sesión',
      'Vas a salir de tu cuenta. Las capturas pendientes seguirán acá hasta que vuelvas a entrar — pero no se podrán sincronizar hasta entonces.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Salir',
          style: 'destructive',
          onPress: async () => {
            setSubmitting(true);
            try {
              await logout();
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  };

  const appVersion =
    Constants.expoConfig?.version ?? '1.0.0';

  return (
    <Screen padding="none">
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Yo</Text>

        {/* Card del usuario */}
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.userName}>
            {user?.fullName ?? 'Operador'}
          </Text>
          <View style={styles.roleChip}>
            <Text style={styles.roleText}>
              {ROLE_LABELS[user?.role ?? ''] ?? user?.role ?? 'Sin rol'}
            </Text>
          </View>
        </View>

        {/* Info detallada */}
        <View style={styles.infoCard}>
          <InfoRow label="Email" value={user?.email ?? '—'} />
          <InfoRow
            label="Entidad"
            value={user?.tenant?.name ?? '—'}
          />
          {/* No exponemos el slug del tenant (identificador interno multi-tenant):
              el operador no lo necesita y el nombre de la entidad ya es suficiente. */}
        </View>

        {/* Seguridad — desbloqueo biométrico (solo si el dispositivo lo soporta) */}
        {bioSupported && (
          <>
            <Text style={styles.sectionTitle}>Seguridad</Text>
            <View style={styles.infoCard}>
              <View style={styles.bioRow}>
                <View style={styles.bioTextWrap}>
                  <Text style={styles.bioLabel}>
                    Desbloqueo con huella / rostro
                  </Text>
                  <Text style={styles.bioHint}>
                    Pide tu biometría al abrir la app. Tu sesión se mantiene; solo
                    agrega protección en el dispositivo.
                  </Text>
                </View>
                <Switch
                  value={bioEnabled}
                  onValueChange={(v) => void onToggleBiometric(v)}
                  disabled={bioBusy}
                  trackColor={{ true: colors.cyan, false: colors.border }}
                  thumbColor="#ffffff"
                />
              </View>
            </View>
          </>
        )}

        {/* Versión de la app (útil para soporte). NO exponemos la URL del
            backend (infraestructura) ni el build interno — el usuario final no
            los necesita y revelan detalles técnicos del sistema. */}
        <Text style={styles.sectionTitle}>Aplicación</Text>
        <View style={styles.infoCard}>
          <InfoRow label="Versión" value={appVersion} mono />
        </View>

        {/* Logout */}
        <View style={styles.logoutWrap}>
          <Button
            label="Cerrar sesión"
            variant="danger"
            onPress={onLogout}
            disabled={submitting}
            loading={submitting}
          />
        </View>

        <Text style={styles.foot}>
          SICE 2.0 — Plataforma de gestión de eventos masivos con evidencia
          probatoria.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text
        style={[
          styles.infoValue,
          mono && { fontVariant: ['tabular-nums'] as const },
        ]}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.extrabold,
    marginBottom: spacing.lg,
  },
  userCard: {
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.cyan,
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText: {
    color: colors.cyan,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.extrabold,
  },
  userName: {
    color: colors.textPrimary,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
    textAlign: 'center',
  },
  roleChip: {
    backgroundColor: colors.cyanSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.full,
    marginTop: spacing.sm,
  },
  roleText: {
    color: colors.cyan,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    letterSpacing: 0.5,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  infoCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  infoLabel: {
    color: colors.textMuted,
    fontSize: fontSizes.sm,
  },
  infoValue: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    flex: 1,
    textAlign: 'right',
  },
  logoutWrap: {
    marginTop: spacing.md,
  },
  foot: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    textAlign: 'center',
    marginTop: spacing.xl,
    lineHeight: 18,
  },
  bioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  bioTextWrap: { flex: 1 },
  bioLabel: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
  },
  bioHint: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    marginTop: 2,
    lineHeight: 16,
  },
});
