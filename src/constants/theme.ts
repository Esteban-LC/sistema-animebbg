// 🎨 THEME CONSTANTS
// Este archivo es 100% reutilizable en React Native
// Solo cambia la implementación de colores (hex en web, StyleSheet en RN)

export const COLORS = {
  // Primary
  primary: '#3B82F6',
  primaryDark: '#2563EB',
  primaryLight: '#60A5FA',

  // Success
  success: '#10B981',
  successDark: '#059669',
  successLight: '#34D399',

  // Warning
  warning: '#F59E0B',
  warningDark: '#D97706',
  warningLight: '#FBBF24',

  // Error
  error: '#EF4444',
  errorDark: '#DC2626',
  errorLight: '#F87171',

  // Info
  info: '#3B82F6',

  // Backgrounds
  backgroundDark: '#0A0E17',
  surfaceDark: '#151B2C',
  surfaceDarker: '#0F1419',

  // Text
  textLight: '#F8FAFC',
  textMuted: '#94A3B8',
  textMutedDark: '#64748B',

  // Gray scale
  gray50: '#F9FAFB',
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  gray900: '#111827',

  // Transparent
  transparent: 'transparent',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
} as const;

export const BORDER_RADIUS = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 24,
  full: 9999,
} as const;

export const FONT_SIZE = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
  '5xl': 48,
} as const;

export const FONT_WEIGHT = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
} as const;

export const SHADOWS = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
} as const;

export const ANIMATION = {
  duration: {
    fast: 150,
    normal: 300,
    slow: 500,
  },
  easing: {
    ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
} as const;

export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export const Z_INDEX = {
  dropdown: 1000,
  sticky: 1020,
  fixed: 1030,
  modalBackdrop: 1040,
  modal: 1050,
  popover: 1060,
  tooltip: 1070,
} as const;

// Helper para obtener color con opacidad
export const withOpacity = (color: string, opacity: number): string => {
  return `${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`;
};

// Estados de componentes
export const STATUS_COLORS = {
  Pendiente: {
    bg: withOpacity(COLORS.warning, 0.1),
    text: COLORS.warning,
    border: withOpacity(COLORS.warning, 0.2),
  },
  'En Proceso': {
    bg: withOpacity(COLORS.info, 0.1),
    text: COLORS.info,
    border: withOpacity(COLORS.info, 0.2),
  },
  Completado: {
    bg: withOpacity(COLORS.success, 0.1),
    text: COLORS.success,
    border: withOpacity(COLORS.success, 0.2),
  },
} as const;

// Iconos por rol
export const ROLE_ICONS = {
  Traductor: 'translate',
  Redrawer: 'brush',
  Typer: 'font_download',
  Admin: 'admin_panel_settings',
} as const;

// Estados de proyecto
export const PROJECT_STATUS = {
  Activo: { color: COLORS.primary, icon: 'play_circle' },
  Pausado: { color: COLORS.warning, icon: 'pause_circle' },
  Finalizado: { color: COLORS.success, icon: 'check_circle' },
} as const;
