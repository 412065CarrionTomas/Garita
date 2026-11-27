import { Pressable, StyleSheet, View } from 'react-native';
import { radius, space, touch } from '@garita/tokens';

import { Icon } from './icon';
import { Text } from './text';
import { useTheme } from './theme';

const OPTIONS = [
  { scheme: 'light', label: 'Claro', icon: 'sun' },
  { scheme: 'dark', label: 'Oscuro', icon: 'moon' },
] as const;

/**
 * Interruptor de tema como el del panel web: sol | luna. Sin elección guardada manda el sistema,
 * y el interruptor marca el tema que se está viendo.
 */
export function ThemeSwitch() {
  const { colors, scheme, setMode } = useTheme();
  return (
    <View style={styles.row}>
      <Text variant="label">Tema</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Tema"
        style={[styles.pill, { borderColor: colors.input }]}
      >
        {OPTIONS.map((option) => {
          const selected = scheme === option.scheme;
          return (
            <Pressable
              key={option.scheme}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected, checked: selected }}
              onPress={() => setMode(option.scheme)}
              style={[styles.side, selected && { backgroundColor: colors.primary }]}
            >
              <Icon name={option.icon} color={selected ? 'primaryForeground' : 'foreground'} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: { flexDirection: 'row', borderWidth: 1.5, borderRadius: radius.full, overflow: 'hidden' },
  side: {
    minWidth: touch.min,
    minHeight: touch.min,
    paddingHorizontal: space[2],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
