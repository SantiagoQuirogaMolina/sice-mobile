/**
 * Button — botón táctil estándar SICE mobile.
 *
 * Variants:
 *   - primary  → cyan brillante para CTAs principales
 *   - secondary → outline cyan
 *   - danger   → rojo para acciones destructivas
 *   - ghost    → solo texto
 */

import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type ViewStyle,
} from 'react-native';
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  TOUCH_MIN,
} from '../lib/theme/tokens';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = true,
  style,
}: ButtonProps) {
  const containerStyle = [
    styles.base,
    variantStyles[variant].container,
    disabled && styles.disabled,
    fullWidth && styles.fullWidth,
    style,
  ];

  const textStyle = [styles.label, variantStyles[variant].label];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        ...containerStyle,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variantStyles[variant].spinnerColor} />
      ) : (
        <Text style={textStyle}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: TOUCH_MIN,
    borderRadius: radii.full,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    fontSize: fontSizes.md,
    fontWeight: fontWeights.bold,
  },
});

const variantStyles: Record<
  Variant,
  {
    container: ViewStyle;
    label: { color: string };
    spinnerColor: string;
  }
> = {
  primary: {
    container: {
      backgroundColor: colors.cyan,
    },
    label: { color: colors.navyDark },
    spinnerColor: colors.navyDark,
  },
  secondary: {
    container: {
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: colors.cyan,
    },
    label: { color: colors.cyan },
    spinnerColor: colors.cyan,
  },
  danger: {
    container: {
      backgroundColor: colors.error,
    },
    label: { color: '#FFFFFF' },
    spinnerColor: '#FFFFFF',
  },
  ghost: {
    container: {
      backgroundColor: 'transparent',
    },
    label: { color: colors.textSecondary },
    spinnerColor: colors.textSecondary,
  },
};
