import { StyleSheet, Text, View } from 'react-native';

import { useApiHealth } from './use-api-health';

const STATUS = {
  pending: { label: 'Verificando conexión…', color: '#a3a3a3' },
  success: { label: 'API conectada', color: '#10b981' },
  error: { label: 'API sin conexión', color: '#ef4444' },
} as const;

/** Indicador del estado de conexión con la API. */
export function ApiStatus() {
  const { label, color } = STATUS[useApiHealth()];

  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLiveRegion="polite">
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    color: '#a3a3a3',
    fontSize: 14,
  },
});
