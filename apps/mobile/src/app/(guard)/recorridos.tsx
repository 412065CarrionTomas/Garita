import { useLocalSearchParams } from 'expo-router';
import { Screen } from '@/ui';
import { RoundScreen } from '@/features/mapa/round-screen';

/**
 * `ids`: versiones de ronda separadas por coma (una o todas las del turno). `hechos` y
 * `siguiente` llegan desde la Ronda en curso.
 */
export default function RoutesRoute() {
  const { ids, hechos, siguiente } = useLocalSearchParams<{
    ids: string;
    hechos?: string;
    siguiente?: string;
  }>();
  const list = (value?: string) => (value ? value.split(',').filter(Boolean) : []);
  return (
    <Screen>
      <RoundScreen versionIds={list(ids)} done={list(hechos)} next={siguiente || undefined} />
    </Screen>
  );
}
