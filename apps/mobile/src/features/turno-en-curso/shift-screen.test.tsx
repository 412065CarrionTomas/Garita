import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { colors } from '@garita/tokens';
import { ThemeProvider, ThemeSwitch } from '@/ui';
import type { PendingFieldEvent, ShiftOfflineData } from '@garita/shared';
import { createDefaultFieldRepository } from '@/lib/db/database';
import { apiGet } from '@/lib/api-client';
import { ShiftScreen } from './shift-screen';
import { beginShift } from './actions';

jest.mock('@/lib/db/database', () => ({ createDefaultFieldRepository: jest.fn() }));
jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn() }));
jest.mock('./actions', () => ({ beginShift: jest.fn(), finishShift: jest.fn() }));
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
    repository.getShiftData.mockResolvedValue(data);
    repository.listPendingEvents.mockResolvedValue([]);
    jest.mocked(createDefaultFieldRepository).mockResolvedValue(repository as never);
  });

  it('HU-34: enables an early start and displays the permitted server time', async () => {
    repository.getShiftData.mockResolvedValue(null as never);
    jest.mocked(apiGet).mockResolvedValue([
      {
        id: 'shift-1',
        startsAt: new Date(Date.now() + 4 * 60 * 60_000).toISOString(),
        endsAt: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
        site: { name: 'Campo' },
        assignments: [{ startsAt: new Date(Date.now() + 4 * 60 * 60_000).toISOString() }],
      },
    ]);
    jest
      .mocked(beginShift)
      .mockResolvedValue({ status: 'error', message: 'Podés iniciarlo desde las 09:40' });
    await act(async () => {
      await render(<ShiftScreen shiftId="shift-1" />);
    });
    const button = await screen.findByRole('button', { name: 'Iniciar turno' });
    expect(button).toBeEnabled();
    await act(async () => {
      await fireEvent.press(button);
    });
    expect(await screen.findByText('Podés iniciarlo desde las 09:40')).toBeOnTheScreen();
    expect(beginShift).toHaveBeenCalledTimes(1);
  });

  it('reopens from local data without API and shows pending checkpoints in round order', async () => {
    await act(async () => {
      await render(<ShiftScreen shiftId="shift-1" />);
      await Promise.resolve();
    });
    expect(await screen.findByText('Predio A')).toBeOnTheScreen();
    expect(
      screen.getByText(/^0 de 2 puntos · Ventana [0-9]{2}:[0-9]{2}–[0-9]{2}:[0-9]{2}$/),
    ).toBeOnTheScreen();
    expect(
      screen.getAllByLabelText(/^Punto [0-9]/).map((item) => item.props.accessibilityLabel),
    ).toEqual(['Punto 1, Acceso, Ahora', 'Punto 2, Portón, Pendiente']);
    expect(apiGet).not.toHaveBeenCalled();
    expect(screen.getAllByText('En curso').length).toBeGreaterThan(0);
    expect(screen.getByText('Cierre de turno')).toBeOnTheScreen();
    expect(screen.getByText('0 de 1 ventanas completas')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Escanear Acceso' })).toHaveStyle({
      backgroundColor: colors.light.primary,
    });
    expect(screen.queryByRole('button', { name: 'Iniciar turno' })).toBeNull();
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
    expect(screen.queryByRole('button', { name: 'Escanear Acceso' })).toBeNull();
    expect(screen.queryByText('En curso')).toBeNull();
  });

  it('navigates to escaneo when clicking Escanear código QR', async () => {
    await act(async () => {
      await render(<ShiftScreen shiftId="shift-1" />);
      await Promise.resolve();
    });
    const scanButton = screen.getByRole('button', { name: 'Escanear Acceso' });
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
    expect(screen.getByLabelText(/^Punto 1, Acceso, [0-9]{2}:[0-9]{2}$/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Punto 2, Portón, Ahora')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Escanear Portón' })).toBeOnTheScreen();
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

  it('displays pending count in singular and plural, and last sync timestamp (ID-162, BDD 1, 2)', async () => {
    // 1 pending: singular
    const singleRepo = {
      ...repository,
      countPendingEvents: jest.fn(async () => 1),
      getSyncMeta: jest.fn(async (key: string) => {
        if (key === 'last_sync_at') return '2026-10-14T14:30:00.000Z';
        return null;
      }),
    };
    jest.mocked(createDefaultFieldRepository).mockResolvedValue(singleRepo as never);
    await act(async () => {
      await render(<ShiftScreen shiftId="shift-1" />);
      await Promise.resolve();
    });

    expect(screen.getByText('1 registro pendiente de envío')).toBeOnTheScreen();
    expect(screen.getByText(/Último envío:/)).toBeOnTheScreen();

    // 5 pending: plural (BDD 1)
    const multiRepo = {
      ...repository,
      countPendingEvents: jest.fn(async () => 5),
      getSyncMeta: jest.fn(async () => null),
    };
    jest.mocked(createDefaultFieldRepository).mockResolvedValue(multiRepo as never);
    await act(async () => {
      await render(<ShiftScreen shiftId="shift-1" />);
      await Promise.resolve();
    });

    expect(screen.getByText('5 registros pendientes de envío')).toBeOnTheScreen();
    expect(screen.getByText('Todavía no se envió nada')).toBeOnTheScreen();
  });

  it('offers only the start action for a scheduled shift', async () => {
    repository.getShiftData.mockResolvedValue(null as never);
    jest.mocked(apiGet).mockResolvedValue([
      {
        id: 'shift-1',
        startsAt: nowUtc,
        endsAt: windowEndUtc,
        site: { name: 'Predio A' },
        assignments: [{ startsAt: nowUtc }],
      },
    ]);
    await render(<ShiftScreen shiftId="shift-1" />);
    expect(await screen.findByRole('button', { name: 'Iniciar turno' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Escanear Acceso' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Iniciar turno' })).toHaveStyle({
      backgroundColor: colors.light.primary,
    });
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('announces an unavailable shift', async () => {
    repository.getShiftData.mockResolvedValue(null as never);
    jest.mocked(apiGet).mockResolvedValue([]);
    await render(<ShiftScreen shiftId="shift-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El turno no está disponible o ya no está asignado.',
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('uses the selected theme for the site, pending names and muted copy', async () => {
    await render(
      <ThemeProvider>
        <ThemeSwitch />
        <ShiftScreen shiftId="shift-1" />
      </ThemeProvider>,
    );
    expect(await screen.findByText('Predio A')).toBeOnTheScreen();
    for (const [label, palette] of [
      ['Claro', colors.light],
      ['Oscuro', colors.dark],
    ] as const) {
      await fireEvent.press(screen.getByLabelText(label));
      expect(screen.getByText('Predio A')).toHaveStyle({ color: palette.foreground });
      expect(screen.getByText('Acceso')).toHaveStyle({ color: palette.foreground });
      expect(screen.getByText('Todavía no se envió nada')).toHaveStyle({
        color: palette.mutedForeground,
      });
      expect(screen.getAllByText('En curso')[0]).toHaveStyle({ color: palette.primaryForeground });
    }
  });
  it('explains missing local data for an in-progress assignment without offering a second start', async () => {
    repository.getShiftData.mockResolvedValue(null as never);
    jest.mocked(apiGet).mockResolvedValue([
      {
        id: 'shift-1',
        status: 'in_progress',
        startsAt: nowUtc,
        endsAt: windowEndUtc,
        site: { name: 'Predio A' },
        assignments: [{ startsAt: nowUtc }],
      },
    ]);
    await render(<ShiftScreen shiftId="shift-1" />);
    expect(await screen.findByText(/Contactá a tu supervisor/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Iniciar turno' })).toBeNull();
    expect(beginShift).not.toHaveBeenCalled();
  });
  it('keeps an incomplete grace window overdue, without counting it complete', async () => {
    const graceData = {
      ...data,
      windows: [{ ...data.windows[0]!, endUtc: new Date(Date.now() - 60_000).toISOString() }],
    };
    repository.getShiftData.mockResolvedValue(graceData);
    await render(<ShiftScreen shiftId="shift-1" />);
    expect(await screen.findByText('Atrasada')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Escanear Acceso' })).toBeOnTheScreen();
    expect(screen.getByText('0 de 1 ventanas completas')).toBeOnTheScreen();
    expect(screen.queryByText('No realizada')).toBeNull();
  });
  it('shows round complete when all rounds with a current window are complete', async () => {
    repository.getShiftData.mockResolvedValue({
      ...data,
      rounds: [...data.rounds, { ...data.rounds[0]!, roundId: 'inactive-round' }],
    });
    jest.mocked(createDefaultFieldRepository).mockResolvedValue({
      ...repository,
      listCheckpointRecords: () =>
        Promise.resolve(
          data.checkpoints.map((point, index) => ({
            recordId: `id-${index}`,
            shiftId: 'shift-1',
            checkpointId: point.id,
            checkpointName: point.name,
            countedFor: [{ roundId: 'round-1', windowIndex: 0, late: false }],
            occurredAtUtc: nowUtc,
            outOfWindow: false,
            createdAt: nowUtc,
          })),
        ),
    } as never);
    await render(<ShiftScreen shiftId="shift-1" />);
    expect(
      await screen.findByText('Ronda completa. Se enviará a supervisión apenas recuperes señal.'),
    ).toBeOnTheScreen();
  });
});
