/**
 * Paleta semántica de Garita (sistema Foja): tinta azul sobre papel frío y un único sello rojo.
 * Lo normal va en tinta; el rojo (`danger`) marca fallas y el ámbar (`warning`) solo demoras.
 * `success` (verde) e `info` (azul) existen pero se usan con mesura: el color aparece en las
 * excepciones. Los estados llevan un par `*Soft` (fondo tenue) y su texto va en el color pleno:
 * nunca comunican solo con color. La barra de navegación (`bar*`) es de tinta en ambos temas.
 */
const light = {
  background: '#F4F6F8',
  foreground: '#1B2540',
  card: '#FFFFFF',
  cardForeground: '#1B2540',
  popover: '#FFFFFF',
  popoverForeground: '#1B2540',
  primary: '#1B2540',
  primaryForeground: '#F4F6F8',
  secondary: '#ECEFF3',
  secondaryForeground: '#1B2540',
  muted: '#ECEFF3',
  mutedForeground: '#56607A',
  accent: '#ECEFF3',
  accentForeground: '#1B2540',
  border: '#D7DCE5',
  input: '#6F7891',
  ring: '#1B2540',
  success: '#1E6B3C',
  successForeground: '#FFFFFF',
  successSoft: '#E9F0EC',
  warning: '#8A5A00',
  warningForeground: '#FFFFFF',
  warningSoft: '#F3EFE6',
  danger: '#A61E22',
  dangerForeground: '#FFFFFF',
  dangerSoft: '#F6E9E9',
  info: '#1B5BB0',
  infoForeground: '#FFFFFF',
  infoSoft: '#E8EFF7',
  bar: '#1B2540',
  barForeground: '#FFFFFF',
  barMuted: '#B9C1D6',
} as const;

export type ColorToken = keyof typeof light;

const dark: Record<ColorToken, string> = {
  background: '#0F1626',
  foreground: '#E6EAF4',
  card: '#161F34',
  cardForeground: '#E6EAF4',
  popover: '#161F34',
  popoverForeground: '#E6EAF4',
  primary: '#E6EAF4',
  primaryForeground: '#0F1626',
  secondary: '#1E2944',
  secondaryForeground: '#E6EAF4',
  muted: '#1E2944',
  mutedForeground: '#A3ACC4',
  accent: '#1E2944',
  accentForeground: '#E6EAF4',
  border: '#2A3552',
  input: '#7A84A3',
  ring: '#E6EAF4',
  success: '#6FD39A',
  successForeground: '#0F1626',
  successSoft: '#223641',
  warning: '#F0B54A',
  warningForeground: '#0F1626',
  warningSoft: '#323337',
  danger: '#FF8A8D',
  dangerForeground: '#0F1626',
  dangerSoft: '#342D40',
  info: '#8DB8FF',
  infoForeground: '#0F1626',
  infoSoft: '#25334E',
  bar: '#0A101D',
  barForeground: '#E6EAF4',
  barMuted: '#A3ACC4',
};

export const colors: { light: Record<ColorToken, string>; dark: Record<ColorToken, string> } = {
  light,
  dark,
};
