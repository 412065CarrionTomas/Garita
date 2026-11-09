import { Pressable, StyleSheet, View } from 'react-native';
import { radius, touch } from '@garita/tokens';

import { Text } from './text';
import { useTheme } from './theme';
import type { ThemeMode } from './theme';

const OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: 'light', label: 'Claro' },
  { mode: 'dark', label: 'Oscuro' },
  { mode: 'system', label: 'Sistema' },
];

/** Selector de apariencia de tres opciones. Va en Configuración / inicio. */
export function ThemeSwitch() {
  const { colors, mode, setMode } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Apariencia"
      style={[styles.group, { borderColor: colors.input }]}
    >
      {OPTIONS.map((option) => {
        const selected = mode === option.mode;
        return (
          <Pressable
            key={option.mode}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, checked: selected }}
            onPress={() => {
              setMode(option.mode);
            }}
            style={[styles.option, selected && { backgroundColor: colors.primary }]}
          >
            <Text variant="label" color={selected ? 'primaryForeground' : 'foreground'}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', borderWidth: 1.5, borderRadius: radius.lg, overflow: 'hidden' },
  option: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touch.min,
  },
});
