import { StyleSheet, View } from 'react-native';
import { radius, space } from '@garita/tokens';

import { useTheme } from './theme';

export type WindowStatus = 'ontime' | 'late' | 'missed' | 'current' | 'pending';

const LABELS: Record<WindowStatus, string> = {
  ontime: 'a tiempo',
  late: 'tardía',
  missed: 'no realizada',
  current: 'en curso',
  pending: 'pendiente',
};

/**
 * Hilera de casilleros, uno por ventana de una ronda. A tiempo: relleno de tinta; tardía: ámbar;
 * no realizada: borde rojo con tachado; en curso: relleno hasta la mitad; pendiente: vacío.
 * Se anuncia como una sola imagen con el conteo por estado.
 */
export function WindowBar({ windows }: { windows: WindowStatus[] }) {
  const { colors } = useTheme();
  const counts = windows.reduce<Partial<Record<WindowStatus, number>>>((acc, status) => {
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
  const summary = (Object.keys(LABELS) as WindowStatus[])
    .filter((status) => counts[status])
    .map((status) => `${counts[status]} ${LABELS[status]}`)
    .join(', ');
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${windows.length} ventanas: ${summary}`}
      style={styles.row}
    >
      {windows.map((status, index) => {
        const color =
          status === 'late'
            ? colors.warning
            : status === 'missed'
              ? colors.danger
              : colors.foreground;
        return (
          <View key={index} style={[styles.box, { borderColor: color }]}>
            {status === 'ontime' || status === 'late' ? (
              <View style={[styles.fill, { backgroundColor: color }]} />
            ) : status === 'current' ? (
              <View style={[styles.half, { backgroundColor: color }]} />
            ) : status === 'missed' ? (
              <View style={[styles.strike, { backgroundColor: color }]} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  box: {
    width: 14,
    height: 22,
    borderWidth: 1.5,
    borderRadius: radius.hairline,
    overflow: 'hidden',
  },
  fill: { flex: 1 },
  half: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%' },
  strike: {
    position: 'absolute',
    top: '50%',
    left: -4,
    width: 24,
    height: 1.5,
    transform: [{ rotate: '60deg' }],
  },
});
