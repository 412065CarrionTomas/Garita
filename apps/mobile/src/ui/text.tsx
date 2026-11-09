import { Text as RNText } from 'react-native';
import type { TextProps as RNTextProps, TextStyle } from 'react-native';
import type { ColorToken } from '@garita/tokens';

import { fontFamily, useTheme } from './theme';

export type TextVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'label'
  | 'caption'
  | 'stamp'
  | 'numeral';

/**
 * Roles de Foja. Rótulos, títulos, sellos y números van en condensada mayúscula; el texto corrido
 * en Public Sans (16 px mínimo, 14 en apoyo). `letterSpacing` va en px (em × tamaño).
 */
const COND_UPPER = { textTransform: 'uppercase' } as const;
const TABULAR = { fontVariant: ['tabular-nums'] } as const satisfies TextStyle;

const VARIANTS: Record<TextVariant, TextStyle> = {
  display: {
    ...COND_UPPER,
    fontFamily: fontFamily.condSemibold,
    fontSize: 32,
    lineHeight: 34,
    letterSpacing: 1.3,
  },
  title: {
    ...COND_UPPER,
    fontFamily: fontFamily.condBold,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: 1,
  },
  heading: {
    ...COND_UPPER,
    fontFamily: fontFamily.condSemibold,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: 0.9,
  },
  subheading: { fontFamily: fontFamily.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 23 },
  label: {
    ...COND_UPPER,
    fontFamily: fontFamily.condSemibold,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 1.4,
  },
  caption: { fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 20 },
  stamp: {
    ...COND_UPPER,
    ...TABULAR,
    fontFamily: fontFamily.condSemibold,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 1,
  },
  numeral: {
    ...TABULAR,
    fontFamily: fontFamily.condSemibold,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.4,
  },
};

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  /** Token de color; por defecto `foreground`. Usar `mutedForeground` para texto secundario. */
  color?: ColorToken;
}

/** Único componente de texto de la app: tipo, tamaño y color salen de los tokens. */
export function Text({ variant = 'body', color = 'foreground', style, ...props }: TextProps) {
  const { colors } = useTheme();
  const isHeader = variant === 'display' || variant === 'title' || variant === 'heading';
  return (
    <RNText
      accessibilityRole={isHeader || variant === 'subheading' ? 'header' : undefined}
      {...props}
      style={[{ color: colors[color] }, VARIANTS[variant], style]}
    />
  );
}
