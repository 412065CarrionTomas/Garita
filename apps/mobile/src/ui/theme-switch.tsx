import { Pressable, StyleSheet, View } from 'react-native';
import { radius, space, touch } from '@garita/tokens';

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
      style={[styles.group, { backgroundColor: colors.muted }]}
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
            style={[styles.option, selected && { backgroundColor: colors.card }]}
          >
            <Text variant="label" color={selected ? 'foreground' : 'mutedForeground'}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', borderRadius: radius.lg, padding: space[1] },
  option: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touch.min,
    borderRadius: radius.md,
  },
});
