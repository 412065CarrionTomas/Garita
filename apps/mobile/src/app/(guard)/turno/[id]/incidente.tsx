import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Banner, Screen, Text } from '@/ui';
import { createDefaultFieldRepository } from '@/lib/db/database';
import type { ShiftOfflineData } from '@garita/shared';
import { IncidentFormScreen } from '@/features/incidentes/incident-form-screen';

export default function ReportIncidentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shiftData, setShiftData] = useState<ShiftOfflineData | null>(null);
  useEffect(() => {
    void createDefaultFieldRepository()
      .then((repository) => repository.getShiftData())
      .then((data) => {
        if (data?.shift.id === id) setShiftData(data);
      })
      .catch(() => setShiftData(null));
  }, [id]);
  if (!shiftData)
    return (
      <Screen>
        <Text variant="heading">Reportar incidente</Text>
        <Banner tone="warning">No hay un turno en curso para este dispositivo.</Banner>
      </Screen>
    );
  return <IncidentFormScreen shiftId={id} shiftData={shiftData} />;
}
