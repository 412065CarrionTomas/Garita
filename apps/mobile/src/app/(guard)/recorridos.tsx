import { useLocalSearchParams } from 'expo-router';
import { Screen } from '@/ui';
import { RoundScreen } from '@/features/mapa/round-screen';

/**
 * `ids`: versiones de ronda separadas por coma (una o todas las del turno). `hechos`,
 * `siguiente` y `enCurso` llegan desde la Ronda en curso.
 */
export default function RoutesRoute() {
  const { ids, hechos, siguiente, enCurso } = useLocalSearchParams<{
    ids: string;
    hechos?: string;
    siguiente?: string;
    enCurso?: string;
  }>();
  const list = (value?: string) => (value ? value.split(',').filter(Boolean) : []);
  return (
    <Screen>
      <RoundScreen
        versionIds={list(ids)}
        done={list(hechos)}
        next={siguiente || undefined}
        live={enCurso === '1'}
      />
    </Screen>
  );
}
