import { Text as RNText } from 'react-native';
import type { TextProps as RNTextProps } from 'react-native';
import { fontSize } from '@garita/tokens';
import type { ColorToken } from '@garita/tokens';

import { fontFamily, useTheme } from './theme';

export type TextVariant =
  'display' | 'title' | 'heading' | 'subheading' | 'body' | 'label' | 'caption';

const VARIANTS = {
  display: { ...fontSize['3xl'], family: fontFamily.bold },
  title: { ...fontSize['2xl'], family: fontFamily.bold },
  heading: { ...fontSize.xl, family: fontFamily.semibold },
  subheading: { ...fontSize.lg, family: fontFamily.semibold },
  body: { ...fontSize.base, family: fontFamily.regular },
  label: { ...fontSize.sm, family: fontFamily.medium },
  caption: { ...fontSize.xs, family: fontFamily.regular },
} as const;

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  /** Token de color; por defecto `foreground`. Usar `mutedForeground` para texto secundario. */
  color?: ColorToken;
}

/** Único componente de texto de la app: tamaño, peso y color salen de los tokens. */
export function Text({ variant = 'body', color = 'foreground', style, ...props }: TextProps) {
  const { colors } = useTheme();
  const { size, lineHeight, family } = VARIANTS[variant];
  return (
    <RNText
      accessibilityRole={
        variant === 'body' || variant === 'label' || variant === 'caption' ? undefined : 'header'
      }
      {...props}
      style={[{ color: colors[color], fontSize: size, lineHeight, fontFamily: family }, style]}
    />
  );
}
