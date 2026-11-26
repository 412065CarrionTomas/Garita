import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GuardRoundVersion } from '@garita/shared';
import { apiGet } from './api-client';
import { clearRoundVersionsMemory, getRoundVersions } from './round-versions';

jest.mock('./api-client', () => {
  const actual = jest.requireActual('./api-client');
  return { ...actual, apiGet: jest.fn() };
});

const version = (id: string): GuardRoundVersion => ({
  id,
  roundId: 'r',
  name: `Ronda ${id}`,
  frequencyMinutes: 60,
  windowStartLocal: '22:00',
  windowEndLocal: '06:00',
  checkpoints: [],
  route: null,
});
const respondWith = () =>
  jest.mocked(apiGet).mockImplementation(async (path) => {
    const ids = new URL(`http://x${path}`).searchParams.get('ids')?.split(',') ?? [];
    return ids.map(version);
  });

beforeEach(async () => {
  jest.clearAllMocks();
  clearRoundVersionsMemory();
  await AsyncStorage.clear();
});

it('pide juntas solo las que faltan y no vuelve a pedir una versión ya vista', async () => {
  respondWith();
  const first = await getRoundVersions(['v3', 'v7', 'v3']);
  expect([...first.keys()]).toEqual(['v3', 'v7']);
  expect(apiGet).toHaveBeenCalledTimes(1);
  expect(jest.mocked(apiGet).mock.calls[0]?.[0]).toBe('/rondas/versiones?ids=v3,v7');

  await getRoundVersions(['v3', 'v9']);
  expect(apiGet).toHaveBeenCalledTimes(2);
  expect(jest.mocked(apiGet).mock.lastCall?.[0]).toBe('/rondas/versiones?ids=v9');
});

it('dos pedidos simultáneos de la misma versión comparten una sola llamada', async () => {
  respondWith();
  const [a, b] = await Promise.all([getRoundVersions(['v1']), getRoundVersions(['v1'])]);
  expect(a.get('v1')?.name).toBe('Ronda v1');
  expect(b.get('v1')?.name).toBe('Ronda v1');
  expect(apiGet).toHaveBeenCalledTimes(1);
});

it('sin señal sirve lo guardado en el celular', async () => {
  respondWith();
  await getRoundVersions(['v5']);
  clearRoundVersionsMemory();
  jest.mocked(apiGet).mockRejectedValue(new Error('offline'));
  const versions = await getRoundVersions(['v5']);
  expect(versions.get('v5')?.name).toBe('Ronda v5');
});
