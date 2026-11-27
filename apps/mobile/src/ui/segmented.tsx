import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { radius, space, touch } from '@garita/tokens';

import { Text } from './text';
import { useTheme } from './theme';

/**
 * Control segmentado del sistema de diseño (chips y filtros): filete de 1,5 px y el elegido
 * invertido. Se desplaza de costado si las opciones no entran.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={label}
      style={styles.scroll}
      contentContainerStyle={[styles.group, { borderColor: colors.foreground }]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.option, selected && { backgroundColor: colors.foreground }]}
          >
            <Text variant="label" color={selected ? 'background' : 'foreground'}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Sin esto, en una pantalla de alto fijo el ScrollView se estira y ocupa el lugar sobrante.
  scroll: { flexGrow: 0 },
  group: { borderWidth: 1.5, borderRadius: radius.lg, overflow: 'hidden' },
  option: { minHeight: touch.min, paddingHorizontal: space[4], justifyContent: 'center' },
});
