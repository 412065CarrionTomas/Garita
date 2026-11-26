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
  expect([...first.versions.keys()]).toEqual(['v3', 'v7']);
  expect(apiGet).toHaveBeenCalledTimes(1);
  expect(jest.mocked(apiGet).mock.calls[0]?.[0]).toBe('/rondas/versiones?ids=v3,v7');

  await getRoundVersions(['v3', 'v9']);
  expect(apiGet).toHaveBeenCalledTimes(2);
  expect(jest.mocked(apiGet).mock.lastCall?.[0]).toBe('/rondas/versiones?ids=v9');
});

it('dos pedidos simultáneos de la misma versión comparten una sola llamada', async () => {
  respondWith();
  const [a, b] = await Promise.all([getRoundVersions(['v1']), getRoundVersions(['v1'])]);
  expect(a.versions.get('v1')?.name).toBe('Ronda v1');
  expect(b.versions.get('v1')?.name).toBe('Ronda v1');
  expect(apiGet).toHaveBeenCalledTimes(1);
});

it('sin señal devuelve lo que hay en el celular aunque falte otra versión', async () => {
  respondWith();
  await getRoundVersions(['v1']);
  clearRoundVersionsMemory();
  jest.mocked(apiGet).mockRejectedValue(new Error('offline'));
  const { versions, failed } = await getRoundVersions(['v1', 'v2']);
  expect([...versions.keys()]).toEqual(['v1']);
  expect(failed).toBe(true);
  await expect(getRoundVersions(['v3'])).rejects.toThrow('offline');
});

it('revalida una vez por día lo guardado en disco', async () => {
  respondWith();
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
  await getRoundVersions(['v8']);
  clearRoundVersionsMemory();
  now.mockReturnValue(1_000 + 60_000);
  await getRoundVersions(['v8']);
  expect(apiGet).toHaveBeenCalledTimes(1);
  clearRoundVersionsMemory();
  now.mockReturnValue(1_000 + 25 * 3_600_000);
  await getRoundVersions(['v8']);
  expect(apiGet).toHaveBeenCalledTimes(2);
  now.mockRestore();
});

it('sin señal sirve lo guardado en el celular', async () => {
  respondWith();
  await getRoundVersions(['v5']);
  clearRoundVersionsMemory();
  jest.mocked(apiGet).mockRejectedValue(new Error('offline'));
  const { versions } = await getRoundVersions(['v5']);
  expect(versions.get('v5')?.name).toBe('Ronda v5');
});

it('una versión que la API no devuelve no cuenta como falla de red', async () => {
  jest.mocked(apiGet).mockResolvedValue([version('v1')]);
  const { versions, failed } = await getRoundVersions(['v1', 'ajena']);
  expect([...versions.keys()]).toEqual(['v1']);
  expect(failed).toBe(false);
});

it('si cambia el usuario mientras vuelve la respuesta, no la guarda para el nuevo', async () => {
  const firebase = jest.requireMock('./firebase') as {
    auth: { currentUser: { uid: string } | null };
  };
  firebase.auth.currentUser = { uid: 'a' };
  let resolve!: (value: GuardRoundVersion[]) => void;
  jest.mocked(apiGet).mockReturnValue(new Promise((r) => (resolve = r)) as never);
  const pending = getRoundVersions(['v1']);
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  firebase.auth.currentUser = { uid: 'b' };
  resolve([version('v1')]);
  await pending.catch(() => undefined);
  expect(await AsyncStorage.getItem('round-version:b:v1')).toBeNull();
  expect(await AsyncStorage.getItem('round-version:a:v1')).toBeNull();
  firebase.auth.currentUser = null;
});
