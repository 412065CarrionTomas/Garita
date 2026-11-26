import { Screen, Text } from '@/ui';
import { MyShiftsScreen } from '@/features/turnos/my-shifts-screen';

function greeting(hour: number) {
  if (hour >= 6 && hour < 12) return 'Buenos días';
  return hour >= 12 && hour < 20 ? 'Buenas tardes' : 'Buenas noches';
}

export default function GuardHome() {
  return (
    <Screen>
      <Text variant="display" accessibilityRole="header">
        {greeting(new Date().getHours())}
      </Text>
      <MyShiftsScreen />
    </Screen>
  );
}
