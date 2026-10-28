import { createDefaultFieldRepository } from '@/lib/db/database';
import { readClock } from '@/lib/clock/clock';
import { resetPanicActionsForTesting, setPanicActionsForTesting, triggerPanic } from './actions';

jest.mock('@/lib/db/database', () => ({ createDefaultFieldRepository: jest.fn() }));
jest.mock('@/lib/clock/clock', () => ({ readClock: jest.fn() }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('expo-location', () => ({ getLastKnownPositionAsync: jest.fn() }));
jest.mock('@/lib/location', () => ({ getCurrentLocation: jest.fn() }));
jest.mock('@/features/panico/transport', () => ({ sendBetterLocation: jest.fn() }));
jest.mock('@/lib/cola/sync-service', () => ({ sendUrgentEvent: jest.fn() }));

describe('panic trigger', () => {
  afterEach(resetPanicActionsForTesting);
  it('persists before transport and vibrates without sound', async () => {
    const order: string[] = [];
    const savePanicAlert = jest.fn(async (alert) => {
      order.push('persist');
      return alert;
    });
    jest.mocked(createDefaultFieldRepository).mockResolvedValue({
      getShiftData: async () => ({ shift: { id: 'shift' } }),
      savePanicAlert,
      listPanicAlerts: async () => [],
    } as never);
    jest.mocked(readClock).mockResolvedValue({
      deviceTime: '2035-01-01T12:00:00.000Z',
      elapsedMs: 1,
      bootId: 'boot',
      timeStatus: 'pending',
      trustedAt: null,
    } as never);
    setPanicActionsForTesting({
      now: () => new Date('2035-01-01T12:00:00Z'),
      uuid: () => '00000000-0000-4000-8000-000000000001',
      lastLocation: async () => ({
        status: 'unverifiable',
        latitude: null,
        longitude: null,
        accuracyMeters: null,
        simulation: 'unavailable',
        takenAt: null,
      }),
      betterLocation: async () => ({
        status: 'unverifiable',
        latitude: null,
        longitude: null,
        accuracyMeters: null,
        simulation: 'unavailable',
        takenAt: null,
      }),
      vibrate: async () => {
        order.push('vibrate');
      },
      send: async () => {
        order.push('send');
      },
    });
    await triggerPanic();
    expect(order).toEqual(['persist', 'vibrate', 'send']);
  });
});
