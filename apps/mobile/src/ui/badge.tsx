import { StyleSheet, View } from 'react-native';
import { radius, space } from '@garita/tokens';

import { Text } from './text';
import { toneColors, useTheme } from './theme';
import type { Tone } from './theme';

/**
 * Sello de estado u hora (la pieza distintiva de Foja): recuadro de 1,5 px con texto condensado.
 * `solid` es el normal, `dashed` marca lo programado o sin señal, `now` invierte (tinta sobre papel).
 * El de falla (`danger`) lleva un segundo contorno y −2° de inclinación. El texto siempre dice el
 * estado: el color solo refuerza.
 */
export function Badge({
  tone = 'neutral',
  label,
  variant = 'solid',
}: {
  tone?: Tone;
  label: string;
  variant?: 'solid' | 'dashed' | 'now';
}) {
  const { colors } = useTheme();
  // El neutro va en tinta (lo normal no hace ruido); los demás en el color pleno de su tono.
  const fg = tone === 'neutral' ? colors.foreground : toneColors(colors, tone).fg;
  const inverted = variant === 'now';
  const border = {
    borderColor: fg,
    borderStyle: variant === 'dashed' ? ('dashed' as const) : ('solid' as const),
  };
  const inner = (
    <View
      style={[styles.stamp, border, { backgroundColor: inverted ? colors.primary : colors.card }]}
    >
      <Text
        variant="stamp"
        style={{ color: inverted ? colors.primaryForeground : fg }}
        accessibilityRole="none"
      >
        {label}
      </Text>
    </View>
  );
  if (tone !== 'danger') return <View style={styles.outer}>{inner}</View>;
  return <View style={[styles.outer, styles.failure, border]}>{inner}</View>;
}

const styles = StyleSheet.create({
  outer: { alignSelf: 'flex-start' },
  stamp: {
    borderWidth: 1.5,
    borderRadius: radius.sm,
    paddingHorizontal: space[2],
    paddingVertical: space[0.5],
  },
  failure: {
    borderWidth: 1.5,
    borderRadius: radius.sm,
    padding: space[0.5],
    transform: [{ rotate: '-2deg' }],
  },
});
