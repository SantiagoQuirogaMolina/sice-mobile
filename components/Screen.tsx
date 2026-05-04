/**
 * Screen — wrapper estándar con SafeArea + bg primary + padding.
 * Mantiene el dark mode de SICE en todas las pantallas.
 */

import { StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../lib/theme/tokens';

interface ScreenProps extends ViewProps {
  /** Padding horizontal aplicado al contenido. Default `lg`. */
  padding?: keyof typeof spacing | 'none';
}

export function Screen({ children, style, padding = 'lg', ...rest }: ScreenProps) {
  const padHorizontal =
    padding === 'none' ? 0 : spacing[padding];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View
        style={[
          styles.container,
          { paddingHorizontal: padHorizontal },
          style,
        ]}
        {...rest}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  container: {
    flex: 1,
  },
});
