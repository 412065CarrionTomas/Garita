import { getCurrentLocation, LocationError, setNativeLocationModuleForTesting } from './location';

const sample = (simulation: 'simulated' | 'not_simulated' | 'unavailable') => ({
  latitude: -34,
  longitude: -58,
  accuracyMeters: 4,
  timestamp: '2026-10-13T12:00:00.000Z',
  simulation,
});
describe('getCurrentLocation', () => {
  afterEach(() => setNativeLocationModuleForTesting(undefined));
  it.each(['simulated', 'not_simulated', 'unavailable'] as const)(
    'validates simulation status %s',
    async (simulation) => {
      setNativeLocationModuleForTesting({
        getCurrentLocation: jest.fn().mockResolvedValue(sample(simulation)),
        getCapabilities: jest.fn(),
      });
      await expect(getCurrentLocation()).resolves.toMatchObject({ simulation });
    },
  );
  it('enforces the five second timeout', async () => {
    jest.useFakeTimers();
    setNativeLocationModuleForTesting({
      getCurrentLocation: jest.fn(() => new Promise(() => {})),
      getCapabilities: jest.fn(),
    });
    const pending = getCurrentLocation();
    jest.advanceTimersByTime(5000);
    await expect(pending).rejects.toMatchObject({ code: 'LOCATION_TIMEOUT' });
    jest.useRealTimers();
  });
  it('maps missing permission to a typed error', async () => {
    setNativeLocationModuleForTesting({
      getCurrentLocation: jest.fn().mockRejectedValue({ code: 'PERMISSION_DENIED' }),
      getCapabilities: jest.fn(),
    });
    await expect(getCurrentLocation()).rejects.toBeInstanceOf(LocationError);
  });
});
