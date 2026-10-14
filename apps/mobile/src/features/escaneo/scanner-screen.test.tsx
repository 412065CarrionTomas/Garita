import { act, render, screen } from '@testing-library/react-native';
import { useCameraPermissions } from 'expo-camera';
import type { ShiftOfflineData } from '@garita/shared';
import { nfcAvailability } from '@/lib/nfc';
import { setScanActionsForTesting } from './scan-action';
import { ScannerScreen } from './scanner-screen';

jest.mock('@/lib/nfc', () => ({
  nfcAvailability: jest.fn(),
}));

const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => true,
  }),
}));

const shiftData: ShiftOfflineData = {
  shift: {
    id: 'shift-1',
    siteId: 'site-1',
    siteName: 'Depósito Ruta 9',
    startsAt: '2026-10-14T22:00:00.000Z',
    endsAt: '2026-10-15T06:00:00.000Z',
    timezone: 'UTC',
    assignmentId: 'assign-1',
  },
  rounds: [
    {
      roundId: 'round-1',
      roundVersionId: 'v-1',
      name: 'Perimetral',
      frequencyMinutes: 120,
      windowStartLocal: '22:00',
      windowEndLocal: '06:00',
      graceMinutes: 15,
      checkpointIds: ['cp-porton'],
    },
  ],
  windows: [
    {
      roundId: 'round-1',
      index: 0,
      startUtc: '2026-10-14T22:00:00.000Z',
      endUtc: '2026-10-15T00:00:00.000Z',
      label: '22:00–00:00',
    },
  ],
  checkpoints: [
    {
      id: 'cp-porton',
      name: 'Portón trasero',
      qrVersion: 1,
      nfcUid: null,
      isIndoor: false,
    },
  ],
  serverTime: { serverNowUtc: '2026-10-14T22:00:00.000Z' },
};

describe('<ScannerScreen />', () => {
  const requestPermissionMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(nfcAvailability).mockResolvedValue('ready');
    jest
      .mocked(useCameraPermissions)
      .mockReturnValue([
        { granted: true, status: 'granted', canAskAgain: true, expires: 'never' } as never,
        requestPermissionMock,
        jest.fn() as never,
      ]);

    setScanActionsForTesting({
      now: () => new Date('2026-10-14T22:30:00.000Z'),
      online: async () => true,
      permissions: async () => 'ok',
      location: async () => ({
        status: 'ok',
        latitude: -34.6,
        longitude: -58.4,
        accuracyMeters: 10,
        simulation: 'not_simulated',
        takenAt: '2026-10-14T22:30:00.000Z',
      }),
      nfc: async () => 'on',
      uuid: () => '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
      send: jest.fn(async () => ({
        result: 'recorded' as const,
        recordId: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
        checkpointId: 'cp-porton',
        countedFor: [{ roundId: 'round-1', windowIndex: 0, late: false }],
        outOfWindow: false,
      })),
      repository: async () =>
        ({
          saveCheckpointRecord: jest.fn(async () => undefined),
          listCheckpointRecords: jest.fn(async () => []),
          addPendingEvent: jest.fn(async () => undefined),
          markPendingEventSent: jest.fn(async () => undefined),
          updateCheckpointRecordServerResult: jest.fn(async () => undefined),
        }) as never,
      feedback: jest.fn(async () => undefined),
    });
  });

  it('shows permission explanation and NFC alternative when camera permission is not granted', async () => {
    jest
      .mocked(useCameraPermissions)
      .mockReturnValue([
        { granted: false, status: 'denied', canAskAgain: true, expires: 'never' } as never,
        requestPermissionMock,
        jest.fn() as never,
      ]);

    await act(async () => {
      render(<ScannerScreen shiftData={shiftData} />);
      await Promise.resolve();
    });

    expect(screen.getByText('Permiso de cámara necesario')).toBeOnTheScreen();
    expect(
      screen.getByText(/Se requiere acceso a la cámara para escanear los códigos QR/),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Habilitar permiso de cámara' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Registrar con NFC' })).toBeOnTheScreen();

    // Clicking enable camera requests permission
    const enableButton = screen.getByRole('button', { name: 'Habilitar permiso de cámara' });
    await act(async () => {
      enableButton.props.onClick?.() ?? enableButton.props.onPress?.();
    });
    expect(requestPermissionMock).toHaveBeenCalledTimes(1);

    // Clicking NFC alternative gives information
    const nfcButton = screen.getByRole('button', { name: 'Registrar con NFC' });
    await act(async () => {
      nfcButton.props.onClick?.() ?? nfcButton.props.onPress?.();
    });
    expect(
      screen.getByText('El registro por NFC estará disponible en la próxima versión.'),
    ).toBeOnTheScreen();
  });

  it('renders camera view, toggles linterna, and navigates back', async () => {
    await act(async () => {
      render(<ScannerScreen shiftData={shiftData} />);
      await Promise.resolve();
    });

    expect(screen.getByTestId('camera-view')).toBeOnTheScreen();
    expect(screen.getByText('Linterna: OFF')).toBeOnTheScreen();

    // Toggle torch on
    const torchButton = screen.getByRole('button', { name: 'Encender linterna' });
    await act(async () => {
      torchButton.props.onClick?.() ?? torchButton.props.onPress?.();
    });
    expect(screen.getByText('Linterna: ON')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Apagar linterna' })).toBeOnTheScreen();

    // Back button
    const backButton = screen.getByRole('button', { name: 'Volver al turno' });
    await act(async () => {
      backButton.props.onClick?.() ?? backButton.props.onPress?.();
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('measures scan confirmation time and confirms in under 5 seconds', async () => {
    const onComplete = jest.fn();

    await act(async () => {
      await render(<ScannerScreen shiftData={shiftData} onScanComplete={onComplete} />);
      await Promise.resolve();
    });

    const cameraView = screen.getByTestId('camera-view');
    const startTime = performance.now();

    // Simulate QR code detection by CameraView
    await act(async () => {
      cameraView.props.onBarcodeScanned({
        type: 'qr',
        data: 'GQR1.cp-porton.1.signature123456789012345678901234567890',
      });
      await Promise.resolve();
    });

    const elapsed = performance.now() - startTime;
    // Requirement: Del QR en cuadro a la confirmación pasan menos de 5 segundos (<5000 ms)
    expect(elapsed).toBeLessThan(5000);

    expect(screen.getByText('Portón trasero registrado')).toBeOnTheScreen();
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'counted',
        message: 'Portón trasero registrado',
      }),
    );

    // Escanear otro punto resets scanner state
    const continueButton = screen.getByRole('button', { name: 'Escanear otro punto' });
    await act(async () => {
      continueButton.props.onClick?.() ?? continueButton.props.onPress?.();
    });
    expect(screen.queryByText('Portón trasero registrado')).toBeNull();
  });
});
