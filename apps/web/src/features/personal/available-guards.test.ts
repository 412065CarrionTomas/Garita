import { apiGet } from '@/lib/api-client';
import { loadAvailableGuards } from './available-guards';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn() }));

it('loads every page of active and pending guards with server filters', async () => {
  jest.mocked(apiGet).mockImplementation((path) => {
    const params = new URL(path, 'https://test.local').searchParams;
    const status = params.get('estado');
    const page = Number(params.get('pagina'));
    return Promise.resolve({ items: [{ id: `${status}-${page}`, status }], paginas: 2 } as never);
  });
  expect((await loadAvailableGuards()).items.map(({ id }) => id)).toEqual([
    'active-1',
    'active-2',
    'invitation_pending-1',
    'invitation_pending-2',
  ]);
  expect(apiGet).toHaveBeenCalledTimes(4);
  expect(jest.mocked(apiGet).mock.calls.every(([path]) => path.includes('rol=guard'))).toBe(true);
});
