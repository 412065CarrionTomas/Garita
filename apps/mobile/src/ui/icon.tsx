import Svg, { Path } from 'react-native-svg';
import type { ColorToken } from '@garita/tokens';

import { useTheme } from './theme';

/** Trazos de los pocos íconos de la app (24 × 24): sin librería de íconos, todo es SVG propio. */
const PATHS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  cross: 'M6 6l12 12M18 6L6 18',
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
} as const;

export type IconName = keyof typeof PATHS;

/** Ícono decorativo: siempre acompañado de texto, por eso no se anuncia. */
export function Icon({
  name,
  size = 20,
  color = 'foreground',
}: {
  name: IconName;
  size?: number;
  color?: ColorToken;
}) {
  const { colors } = useTheme();
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        d={PATHS[name]}
        stroke={colors[color]}
        strokeWidth={2.5}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </Svg>
  );
}
