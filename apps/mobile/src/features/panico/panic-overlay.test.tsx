import { act, fireEvent, render, userEvent, waitFor } from '@testing-library/react-native';
import { triggerPanic } from './actions';
import { fetchPanicState } from './transport';
import { createDefaultFieldRepository, type LocalPanicAlert } from '@/lib/db/database';
import { PanicOverlay } from './panic-overlay';

jest.mock('./actions', () => ({ triggerPanic: jest.fn().mockResolvedValue(undefined) }));
jest.mock('./transport', () => ({
  resumePanicAlerts: jest.fn().mockResolvedValue(undefined),
  fetchPanicState: jest.fn(),
}));
jest.mock('@/lib/db/database', () => ({ createDefaultFieldRepository: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('panic button', () => {
  let alerts: LocalPanicAlert[];
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(triggerPanic).mockClear();
    alerts = [];
    jest.mocked(createDefaultFieldRepository).mockResolvedValue({
      listPanicAlerts: async () => alerts,
      getShiftData: async () => ({ shift: { id: 'shift' } }),
      updatePanicAlert: jest.fn(),
    } as never);
  });
  afterEach(() => jest.useRealTimers());

  it('requires two seconds and allows the screen-reader activation actions', async () => {
    const rendered = await render(<PanicOverlay />);
    const button = rendered.getByLabelText('Pánico, mantener presionado');
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.press(button);
    expect(triggerPanic).not.toHaveBeenCalled();
    await user.longPress(button, { duration: 1999 });
    expect(triggerPanic).not.toHaveBeenCalled();
    await user.longPress(button, { duration: 2000 });
    expect(triggerPanic).toHaveBeenCalledTimes(1);
    await fireEvent(button, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    await fireEvent(button, 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } });
    expect(triggerPanic).toHaveBeenCalledTimes(3);
    expect(rendered.queryByText(/cancelar/i)).toBeNull();
  });

  it('shows receipt and supervisor confirmation only from server state', async () => {
    alerts = [{ request: { shiftId: 'shift' }, state: null } as LocalPanicAlert];
    const rendered = await render(<PanicOverlay />);
    expect(rendered.queryByText('Alerta recibida por la central')).toBeNull();
    const state = {
      alertId: '00000000-0000-4000-8000-000000000001',
      status: 'active' as const,
      receivedAt: '2035-01-01T12:00:00Z',
      confirmedAt: null,
    };
    alerts[0] = { ...alerts[0]!, state };
    jest.mocked(fetchPanicState).mockResolvedValue(state);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    await waitFor(() => expect(rendered.getByText('Alerta recibida por la central')).toBeTruthy());
    expect(rendered.queryByText('Confirmada por el supervisor')).toBeNull();
    jest
      .mocked(fetchPanicState)
      .mockResolvedValue({ ...state, status: 'confirmed', confirmedAt: '2035-01-01T12:01:00Z' });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    await waitFor(() => expect(rendered.getByText('Confirmada por el supervisor')).toBeTruthy());
  });
});
