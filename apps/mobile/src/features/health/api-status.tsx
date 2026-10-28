import { View } from 'react-native';
import { Badge } from '@/ui';

import { useApiHealth } from './use-api-health';

const STATUS = {
  pending: { label: 'Verificando conexión…', tone: 'neutral' },
  success: { label: 'API conectada', tone: 'success' },
  error: { label: 'API sin conexión', tone: 'danger' },
} as const;

/** Indicador del estado de conexión con la API. */
export function ApiStatus() {
  const { label, tone } = STATUS[useApiHealth()];

  return (
    <View accessible accessibilityRole="text" accessibilityLiveRegion="polite">
      <Badge tone={tone} label={label} />
    </View>
  );
}
