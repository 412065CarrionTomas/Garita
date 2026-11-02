import { render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { ThemeProvider } from '@/ui';
import { LockedPanicPermissionNotice } from './permission-notice';

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: false })),
}));
const message = 'Activá las notificaciones para usar el pánico con el celular bloqueado';
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
});
it('shows a discreet notice only once for the shift without asking permission', async () => {
  const view = await render(
    <ThemeProvider>
      <LockedPanicPermissionNotice shiftId="shift-1" />
    </ThemeProvider>,
  );
  expect(await screen.findByText(message)).toBeTruthy();
  await view.unmount();
  await render(
    <ThemeProvider>
      <LockedPanicPermissionNotice shiftId="shift-1" />
    </ThemeProvider>,
  );
  expect(screen.queryByText(message)).toBeNull();
});
it('does nothing on iOS', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  await render(
    <ThemeProvider>
      <LockedPanicPermissionNotice shiftId="shift-1" />
    </ThemeProvider>,
  );
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  expect(screen.queryByText(message)).toBeNull();
});
