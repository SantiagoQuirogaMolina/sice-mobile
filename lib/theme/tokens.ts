/**
 * SICE — Design tokens (espejo de la web).
 *
 * Mantenemos los mismos colores que el design system para que la app
 * mobile y la PWA web tengan identidad visual unificada.
 */

export const colors = {
  // Backgrounds
  bgPrimary: '#0D1B2A',
  bgCard: '#172033',
  bgInput: '#1F2A3F',
  bgAccent: 'rgba(0,212,255,0.04)',
  bgHover: 'rgba(255,255,255,0.04)',

  // Text
  textPrimary: '#E5E9F0',
  textSecondary: '#A5B0C2',
  textMuted: '#6E7A91',

  // Brand
  cyan: '#00D4FF',
  cyanSoft: 'rgba(0,212,255,0.12)',
  blue: '#3B82F6',
  navyDark: '#0D1B2A',

  // Status
  success: '#10B981',
  successBg: 'rgba(16,185,129,0.12)',
  warning: '#F59E0B',
  warningBg: 'rgba(245,158,11,0.12)',
  error: '#EF4444',
  errorBg: 'rgba(239,68,68,0.12)',
  conflict: '#F97316',

  // Borders
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.15)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
};

export const fontSizes = {
  xs: 11,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 24,
  xxxl: 32,
};

export const fontWeights = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
};

/** Touch target mínimo Material Design — botones, items de lista. */
export const TOUCH_MIN = 48;
