import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { PressableProps } from 'react-native';
import { radius, space, touch } from '@garita/tokens';

import { Text } from './text';
import { useTheme } from './theme';

export interface ListItemProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  subtitle?: string;
  /** Línea extra bajo el subtítulo (p. ej. la ubicación del predio). */
  detail?: string;
  /** Estado o dato a la derecha: normalmente un `Badge`. */
  trailing?: ReactNode;
}

/** Fila tocable de una lista (mis turnos, predios, puntos): hoja plana con filete. Alto mínimo 56 px. */
export function ListItem({ title, subtitle, detail, trailing, ...props }: ListItemProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      {...props}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.texts}>
        <Text variant="subheading">{title}</Text>
        {subtitle ? <Text color="mutedForeground">{subtitle}</Text> : null}
        {detail ? (
          <Text variant="caption" color="mutedForeground">
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: touch.action,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space[4],
  },
  texts: { flex: 1, gap: space[0.5] },
  pressed: { opacity: 0.85 },
});
