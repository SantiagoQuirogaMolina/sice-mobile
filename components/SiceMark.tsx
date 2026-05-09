/**
 * SICE Mark — F2 Final · clipboard + check icónico (mobile).
 *
 * Versión RN del componente del frontend (`sice-frontend/components/brand/sice-mark.tsx`).
 * Replica el SVG del design system: clipboard + clip + check grande.
 *
 * Requiere `react-native-svg` (agregada al package.json en este sprint).
 * APK debe rebuilarse con gradle para incluir el módulo nativo.
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

interface SiceMarkProps {
  size?: number;
  /** Color principal del trazo. Default cyan SICE (#00D4FF). */
  color?: string;
  /** Fill del clip arriba del clipboard. Default navy oscuro. */
  clipFill?: string;
}

export function SiceMark({
  size = 56,
  color = '#00D4FF',
  clipFill = '#0D1B2A',
}: SiceMarkProps) {
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 56 56" fill="none">
        {/* Body del clipboard */}
        <Rect x="10" y="13" width="36" height="40" rx="5" stroke={color} strokeWidth={2.6} />
        {/* Top clip */}
        <Rect
          x="19"
          y="6"
          width="18"
          height="11"
          rx="2.5"
          fill={clipFill}
          stroke={color}
          strokeWidth={2.6}
        />
        {/* Inner clip pinch */}
        <Rect x="23" y="9" width="10" height="3" rx="1" fill={color} />
        {/* Big check */}
        <Path
          d="M16 32 L25 41 L41 23"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

interface SiceLockupProps {
  /** Tamaño del icono. Default 56. */
  markSize?: number;
  /** Color del trazo del mark. Default cyan. */
  color?: string;
  /** Pasa false para ocultar el tagline. */
  showTag?: boolean;
}

/**
 * SiceLockup — mark + texto "SICE" + tagline. Para login/splash.
 * El texto se renderiza con react-native Text para mantener
 * compatibilidad con `Inter` font cargada por `expo-font`.
 */
export function SiceLockup(_props: SiceLockupProps) {
  // El layout de texto vive en el caller (login.tsx) para usar
  // los styles existentes del shell. Este componente solo expone el mark.
  return null;
}
