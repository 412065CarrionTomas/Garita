import { act, render, screen, waitFor } from '@testing-library/react-native';
import type { PendingFieldEvent, ShiftOfflineData } from '@garita/shared';
import { createDefaultFieldRepository } from '@/lib/db/database';
import { apiGet } from '@/lib/api-client';
import { ShiftScreen } from './shift-screen';

jest.mock('@/lib/db/database', () => ({ createDefaultFieldRepository: jest.fn() }));
jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn() }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush }),
  useFocusEffect: (callback: () => void) => {
    const React = jest.requireActual('react') as {
      useEffect: (effect: () => void, dependencies: readonly unknown[]) => void;
    };
    React.useEffect(callback, [callback]);
  },
}));

const nowUtc = new Date().toISOString();
const windowStartUtc = new Date(Date.now() - 60 * 60_000).toISOString();
const windowEndUtc = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
const data: ShiftOfflineData = {
  shift: {
    id: 'shift-1',
    siteId: 'site-1',
    siteName: 'Predio A',
    startsAt: nowUtc,
    endsAt: windowEndUtc,
    timezone: 'UTC',
    assignmentId: 'assignment-1',
  },
  rounds: [
    {
      roundId: 'round-1',
      roundVersionId: 'version-1',
      name: 'Perimetral',
      frequencyMinutes: 60,
      windowStartLocal: '00:00',
      windowEndLocal: '01:00',
      graceMinutes: 5,
      checkpointIds: ['point-2', 'point-1'],
    },
  ],
  windows: [
    {
      roundId: 'round-1',
      index: 0,
      startUtc: windowStartUtc,
      endUtc: windowEndUtc,
      label: 'Ventana nocturna',
    },
  ],
  checkpoints: [
    { id: 'point-1', name: 'Portón', qrVersion: 1, nfcUid: null, isIndoor: false },
    { id: 'point-2', name: 'Acceso', qrVersion: 1, nfcUid: null, isIndoor: false },
  ],
  serverTime: { serverNowUtc: nowUtc },
};
const repository = {
  getShiftData: jest.fn(async () => data),
  listPendingEvents: jest.fn(async (): Promise<PendingFieldEvent[]> => []),
};

describe('<ShiftScreen />', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.listPendingEvents.mockResolvedValue([]);
    jest.mocked(createDefaultFieldRepository).mockResolvedValue(repository as never);
  });

  it('reopens from local data without API and shows pending checkpoints in round order', async () => {
    await act(async () => {
      await render(<ShiftScreen shiftId="shift-1" />);
      await Promise.resolve();
    });
    expect(await screen.findByText('Predio A')).toBeOnTheScreen();
    expect(screen.getByText('Ventana Ventana nocturna')).toBeOnTheScreen();
    expect(
      screen
        .getAllByText(/Acceso|Portón/)
        .map((item) => item.props.children.join?.('') ?? item.props.children),
    ).toEqual(['• Acceso', '• Portón']);
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('shows closed-pending state reconstructed from local pending events', async () => {
    repository.listPendingEvents.mockResolvedValue([
      {
        id: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
        type: 'shift_close',
        payload: { shiftId: 'shift-1' },
        occurredAtDevice: '2030-01-02T00:30:00.000Z',
        createdAt: '2030-01-02T00:30:00.000Z',
      },
    ]);
    await act(async () => {
      await render(<ShiftScreen shiftId="shift-1" />);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByText('Turno cerrado, pendiente de envío.')).toBeOnTheScreen(),
    );
    expect(screen.queryByRole('button', { name: 'Cerrar turno' })).toBeNull();
  });

  it('navigates to escaneo when clicking Escanear código QR', async () => {
    await act(async () => {
      await render(<ShiftScreen shiftId="shift-1" />);
      await Promise.resolve();
    });
    const scanButton = screen.getByRole('button', { name: 'Escanear código QR' });
    expect(scanButton).toBeOnTheScreen();
    await act(async () => {
      scanButton.props.onClick?.() ?? scanButton.props.onPress?.();
    });
    expect(mockPush).toHaveBeenCalledWith('/escaneo');
  });

  it('filters out locally recorded checkpoints from pending list', async () => {
    const customRepo = {
      ...repository,
      listCheckpointRecords: jest.fn(async () => [
        {
          recordId: 'rec-1',
          shiftId: 'shift-1',
          checkpointId: 'point-2', // Acceso
          checkpointName: 'Acceso',
          occurredAtUtc: nowUtc,
          countedFor: [{ roundId: 'round-1', windowIndex: 0, late: false }],
          outOfWindow: false,
          serverResult: 'recorded',
          serverReason: null,
          createdAt: nowUtc,
        },
      ]),
    };
    jest.mocked(createDefaultFieldRepository).mockResolvedValue(customRepo as never);
    await act(async () => {
      await render(<ShiftScreen shiftId="shift-1" />);
      await Promise.resolve();
    });
    // Acceso is recorded, only Portón remains pending!
    expect(screen.queryByText('• Acceso')).toBeNull();
    expect(screen.getByText('• Portón')).toBeOnTheScreen();
  });

  it('displays alert for server-rejected records', async () => {
    const customRepo = {
      ...repository,
      listCheckpointRecords: jest.fn(async () => [
        {
          recordId: 'rec-rejected',
          shiftId: 'shift-1',
          checkpointId: 'point-1',
          checkpointName: 'Portón',
          occurredAtUtc: nowUtc,
          countedFor: [{ roundId: 'round-1', windowIndex: 0, late: false }],
          outOfWindow: false,
          serverResult: 'rejected' as const,
          serverReason: 'outdated_version',
          createdAt: nowUtc,
        },
      ]),
    };
    jest.mocked(createDefaultFieldRepository).mockResolvedValue(customRepo as never);
    await act(async () => {
      await render(<ShiftScreen shiftId="shift-1" />);
      await Promise.resolve();
    });
    expect(screen.getByText('Registros observados por el servidor')).toBeOnTheScreen();
    expect(screen.getByText('• Portón: Código QR desactualizado')).toBeOnTheScreen();
  });
});
