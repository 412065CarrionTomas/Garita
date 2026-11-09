import { StyleSheet, View } from 'react-native';
import type { ViewProps } from 'react-native';
import { radius, space } from '@garita/tokens';

import { useTheme } from './theme';

/** Superficie con borde para agrupar un bloque de contenido. Sin sombra: el borde ya separa. */
export function Card({ style, ...props }: ViewProps) {
  const { colors } = useTheme();
  return (
    <View
      {...props}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, style]}
    />
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.md, padding: space[4], gap: space[3] },
});
