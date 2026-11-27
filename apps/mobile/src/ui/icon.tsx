import Svg, { Path } from 'react-native-svg';
import type { ColorToken } from '@garita/tokens';

import { useTheme } from './theme';

/** Trazos de los pocos íconos de la app (24 × 24): sin librería de íconos, todo es SVG propio. */
const PATHS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  cross: 'M6 6l12 12M18 6L6 18',
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  menu: 'M4 7h16M4 12h16M4 17h16',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
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
