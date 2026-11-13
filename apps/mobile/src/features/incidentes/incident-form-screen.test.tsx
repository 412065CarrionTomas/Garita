import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ShiftOfflineData } from '@garita/shared';
import * as ImagePicker from 'expo-image-picker';
import { createDefaultFieldRepository } from '@/lib/db/database';
import { readClock } from '@/lib/clock/clock';
import { getCurrentLocation } from '@/lib/location';
import { processSyncQueue } from '@/lib/cola';
import { reduceIncidentPhoto } from '@/lib/fotos/reduce-photo';
import { processIncidentPhotos } from '@/lib/fotos/photo-queue';
import { IncidentFormScreen } from './incident-form-screen';

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
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
  it('persists photos before sending the event and processes them after event sync finishes', async () => {
    const addPendingEvent = jest.fn(async () => undefined);
    const addIncidentPhoto = jest.fn(async () => undefined);
    jest.mocked(createDefaultFieldRepository).mockResolvedValue({
      addPendingEvent,
      addIncidentPhoto,
    } as never);
    jest.mocked(readClock).mockResolvedValue({
      deviceTime: '2026-10-21T09:00:00.000Z',
      trustedAt: null,
      elapsedMs: 0,
      bootId: 'boot-1',
      timeStatus: 'unverifiable',
      referenceOffsetMs: null,
    });
    jest.mocked(getCurrentLocation).mockRejectedValue(new Error('sin ubicación'));
    jest
      .mocked(ImagePicker.requestMediaLibraryPermissionsAsync)
      .mockResolvedValue({ granted: true } as never);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///chosen.jpg', width: 100, height: 100 }],
    } as never);
    let finishReduction!: (photo: Awaited<ReturnType<typeof reduceIncidentPhoto>>) => void;
    jest.mocked(reduceIncidentPhoto).mockReturnValue(
      new Promise((resolve) => {
        finishReduction = resolve;
      }),
    );
    let finishSync!: (result: Awaited<ReturnType<typeof processSyncQueue>>) => void;
    jest.mocked(processSyncQueue).mockReturnValue(
      new Promise((resolve) => {
        finishSync = resolve;
      }),
    );
    const view = await render(
      <IncidentFormScreen shiftId="00000000-0000-4000-8000-000000000001" shiftData={shiftData} />,
    );
    await fireEvent.press(view.getByLabelText('Elegir de galería'));
    await fireEvent.press(view.getByLabelText('Guardar incidente'));
    await waitFor(() => expect(reduceIncidentPhoto).toHaveBeenCalled());
    expect(processSyncQueue).not.toHaveBeenCalled();
    await act(async () => {
      finishReduction({ uri: 'file:///reduced.jpg' } as never);
    });
    await waitFor(() => expect(processSyncQueue).toHaveBeenCalled());
    expect(addIncidentPhoto).toHaveBeenCalled();
    expect(processIncidentPhotos).not.toHaveBeenCalled();
    await act(async () => {
      finishSync({ processed: 1, batchesSent: 1, success: true });
    });
    expect(processIncidentPhotos).toHaveBeenCalled();
  });
  it('marks exactly one incident type as selected', async () => {
    const { getByLabelText } = await render(
      <IncidentFormScreen shiftId="shift-1" shiftData={shiftData} />,
    );
    expect(getByLabelText('Intrusión').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(getByLabelText('Otro'));
    expect(getByLabelText('Intrusión').props.accessibilityState.selected).toBe(false);
    expect(getByLabelText('Otro').props.accessibilityState.selected).toBe(true);
  });

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
