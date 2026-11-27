import { ApiError, apiRequest } from '@/lib/api-client';
import { ShiftExecutionApiError, startShift } from './api';

jest.mock('@/lib/api-client', () => ({
  apiRequest: jest.fn(),
  ApiError: class extends Error {
    readonly status: number | undefined;
    readonly payload: unknown;
    constructor(message: string, status?: number, payload?: unknown) {
      super(message);
      this.status = status;
      this.payload = payload;
    }
  },
}));

const input = {
  eventId: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
  occurredAtDevice: '2030-01-01T12:00:00Z',
  location: {
    status: 'disabled' as const,
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    simulation: 'unavailable' as const,
    takenAt: null,
  },
};

describe('HU-34 start errors', () => {
  it('HU-43 preserves the validated suspension message', async () => {
    const message = 'La cuenta de tu empresa está suspendida. Consultá a tu supervisor.';
    jest.mocked(apiRequest).mockRejectedValue(
      new ApiError('Suspendida', 402, {
        code: 'ACCOUNT_SUSPENDED',
        accountStatus: 'suspended',
        message,
      }),
    );
    await expect(startShift('shift', input)).rejects.toMatchObject({ message });
  });
  it('HU-43 uses fixed copy for malformed suspension and keeps other errors generic', async () => {
    jest
      .mocked(apiRequest)
      .mockRejectedValue(
        new ApiError('No mostrar', 402, { code: 'ACCOUNT_SUSPENDED', message: { secret: true } }),
      );
    await expect(startShift('shift', input)).rejects.toMatchObject({
      message: 'La cuenta de tu empresa está suspendida. Consultá a tu supervisor.',
    });
    jest.mocked(apiRequest).mockRejectedValue(new ApiError('No mostrar', 409, { code: 'OTHER' }));
    await expect(startShift('shift', input)).rejects.toMatchObject({
      message: 'No se pudo completar la operación del turno.',
    });
  });
  it('preserves the validated start time and timezone from the API', async () => {
    const allowed = {
      startFrom: '2030-01-01T12:40:00Z',
      timezone: 'America/Argentina/Buenos_Aires',
    };
    jest
      .mocked(apiRequest)
      .mockRejectedValue(
        new ApiError('Ventana', 422, { code: 'OUTSIDE_START_MARGIN', ...allowed }),
      );
    await expect(startShift('shift', input)).rejects.toMatchObject({
      code: 'OUTSIDE_START_MARGIN',
      allowedStart: allowed,
    });
  });
  it.each([
    { startFrom: 'bad', timezone: 'UTC' },
    { startFrom: '2030-01-01T12:40:00Z', timezone: 'bad' },
  ])('ignores malformed start metadata %s', async (metadata) => {
    jest
      .mocked(apiRequest)
      .mockRejectedValue(
        new ApiError('Ventana', 422, { code: 'OUTSIDE_START_MARGIN', ...metadata }),
      );
    await expect(startShift('shift', input)).rejects.toEqual(
      new ShiftExecutionApiError('OUTSIDE_START_MARGIN'),
    );
  });
});
