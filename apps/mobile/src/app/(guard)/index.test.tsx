import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { createDefaultFieldRepository } from '@/lib/db/database';
import GuardHome from './index';

const mockLogout = jest.fn();
jest.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ logout: mockLogout, user: { role: 'guard' } }),
}));

jest.mock('@/features/turnos/my-shifts-screen', () => ({
  MyShiftsScreen: () => null,
}));

jest.mock('@/lib/db/database', () => ({
  createDefaultFieldRepository: jest.fn(),
}));

describe('GuardHome logout with pending events (CA6)', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('logs out directly when there are 0 pending events', async () => {
    jest.mocked(createDefaultFieldRepository).mockResolvedValue({
      countPendingEvents: jest.fn(async () => 0),
    } as never);

    await act(async () => {
      await render(<GuardHome />);
    });

    const logoutBtn = screen.getByRole('button', { name: 'Cerrar sesión' });
    await act(async () => {
      fireEvent.press(logoutBtn);
    });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('shows warning alert with count when there are pending events and does not logout on cancel', async () => {
    jest.mocked(createDefaultFieldRepository).mockResolvedValue({
      countPendingEvents: jest.fn(async () => 3),
    } as never);

    await act(async () => {
      await render(<GuardHome />);
    });

    const logoutBtn = screen.getByRole('button', { name: 'Cerrar sesión' });
    await act(async () => {
      fireEvent.press(logoutBtn);
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Registros pendientes de envío',
      expect.stringContaining('Tenés 3 registros pendientes de envío.'),
      expect.any(Array),
    );
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('logs out and preserves events when user confirms the alert', async () => {
    jest.mocked(createDefaultFieldRepository).mockResolvedValue({
      countPendingEvents: jest.fn(async () => 1),
    } as never);

    await act(async () => {
      await render(<GuardHome />);
    });

    const logoutBtn = screen.getByRole('button', { name: 'Cerrar sesión' });
    await act(async () => {
      fireEvent.press(logoutBtn);
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Registros pendientes de envío',
      expect.stringContaining('Tenés 1 registro pendiente de envío.'),
      expect.any(Array),
    );

    // Call the confirm button handler
    const buttons = alertSpy.mock.calls[0][2];
    const confirmButton = buttons.find((b: { text: string }) => b.text === 'Cerrar sesión');
    expect(confirmButton).toBeDefined();

    await act(async () => {
      confirmButton.onPress();
    });

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
