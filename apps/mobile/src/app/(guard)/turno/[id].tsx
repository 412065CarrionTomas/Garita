import { useLocalSearchParams } from 'expo-router';
import { ShiftScreen } from '@/features/turno-en-curso/shift-screen';

export default function ShiftRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ShiftScreen shiftId={id} />;
}
