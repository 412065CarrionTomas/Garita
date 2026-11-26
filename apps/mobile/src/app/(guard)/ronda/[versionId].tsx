import { useLocalSearchParams } from 'expo-router';
import { Screen } from '@/ui';
import { RoundScreen } from '@/features/mapa/round-screen';

/** `hechos` (ids separados por coma) y `siguiente` llegan desde la Ronda en curso. */
export default function RoundRoute() {
  const { versionId, hechos, siguiente } = useLocalSearchParams<{
    versionId: string;
    hechos?: string;
    siguiente?: string;
  }>();
  return (
    <Screen>
      <RoundScreen versionId={versionId} done={hechos ? hechos.split(',') : []} next={siguiente} />
    </Screen>
  );
}
