import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { space } from '@garita/tokens';

import { Text } from './text';
import { useTheme } from './theme';

/** Indicador de carga con texto que dice qué se está cargando. */
export function Loading({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.row}>
      <ActivityIndicator color={colors.primary} />
      <Text color="mutedForeground">{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
});
