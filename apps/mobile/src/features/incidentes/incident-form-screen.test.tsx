import { fireEvent, render } from '@testing-library/react-native';
import type { ShiftOfflineData } from '@garita/shared';
import { IncidentFormScreen } from './incident-form-screen';

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/lib/db/database', () => ({ createDefaultFieldRepository: jest.fn() }));
jest.mock('@/lib/clock/clock', () => ({ readClock: jest.fn() }));
jest.mock('@/lib/location', () => ({ getCurrentLocation: jest.fn() }));
jest.mock('@/lib/cola', () => ({ processSyncQueue: jest.fn() }));
jest.mock('@/lib/fotos/reduce-photo', () => ({ reduceIncidentPhoto: jest.fn() }));
jest.mock('@/lib/fotos/photo-queue', () => ({ processIncidentPhotos: jest.fn() }));

const shiftData = {
  shift: {
    id: 'shift-1',
    siteId: 'site-1',
    siteName: 'Predio norte',
    startsAt: '2026-10-21T08:00:00.000Z',
    endsAt: '2026-10-21T16:00:00.000Z',
    timezone: 'UTC',
    assignmentId: 'assignment-1',
  },
  rounds: [],
  windows: [],
  checkpoints: [],
  serverTime: { serverNowUtc: '2026-10-21T09:00:00.000Z' },
} satisfies ShiftOfflineData;

describe('<IncidentFormScreen />', () => {
  it('requires a description for Otro and enables saving when supplied', async () => {
    const { getByLabelText, getByText, queryByText } = await render(
      <IncidentFormScreen shiftId="shift-1" shiftData={shiftData} />,
    );
    await fireEvent.press(getByLabelText('Otro'));
    expect(getByText('Describí el incidente para continuar.')).toBeOnTheScreen();
    expect(getByLabelText('Guardar incidente').props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(getByLabelText('Descripción'), 'Demora del relevo');
    expect(queryByText('Describí el incidente para continuar.')).toBeNull();
    expect(getByLabelText('Guardar incidente').props.accessibilityState.disabled).toBe(false);
  });
});
