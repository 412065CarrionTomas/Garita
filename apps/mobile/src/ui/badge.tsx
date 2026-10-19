import { StyleSheet, View } from 'react-native';
import { radius, space } from '@garita/tokens';

import { Text } from './text';
import { toneColors, useTheme } from './theme';
import type { Tone } from './theme';

/**
 * Estado de un turno, ventana o registro: punto + texto. El color refuerza, pero el texto
 * siempre dice el estado. Mismo tono para el mismo estado en todas las pantallas.
 */
export function Badge({ tone, label }: { tone: Tone; label: string }) {
  const { colors } = useTheme();
  const { fg, bg } = toneColors(colors, tone);
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <View style={[styles.dot, { backgroundColor: fg }]} />
      <Text variant="caption" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space[1.5],
    borderRadius: radius.full,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  dot: { width: 6, height: 6, borderRadius: radius.full },
});
