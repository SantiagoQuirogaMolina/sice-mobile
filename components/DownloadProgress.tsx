/**
 * DownloadProgress — estado de carga con barra animada + conteo en vivo.
 *
 * Se usa cuando el gestor descarga la lista del evento (puede ser de miles).
 * Da feedback claro de progreso para que NO se "sienta trabado" con listas
 * grandes (el fetch-all pagina y reporta el acumulado vía `count`).
 */

import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, fontSizes, fontWeights, spacing } from '../lib/theme/tokens';

export function DownloadProgress({ count }: { count: number }) {
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [x]);

  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [-90, 230] });

  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={colors.cyan} size="large" />
      <Text style={styles.title}>Descargando lista del evento…</Text>
      <Text style={styles.count}>
        {count > 0
          ? `${count.toLocaleString('es-CO')} beneficiarios`
          : 'Conectando…'}
      </Text>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { transform: [{ translateX }] }]} />
      </View>
      <Text style={styles.hint}>
        La primera vez puede tardar unos segundos según el tamaño de la lista. Se
        guarda en el dispositivo para usarla sin internet.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    marginTop: spacing.sm,
  },
  count: {
    color: colors.cyan,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.extrabold,
  },
  track: {
    width: 220,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginVertical: spacing.xs,
  },
  fill: {
    width: 80,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.cyan,
  },
  hint: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xs,
  },
});
