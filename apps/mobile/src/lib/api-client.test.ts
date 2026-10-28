import { z } from 'zod';
import { apiRequest } from './api-client';

jest.mock('@/lib/firebase', () => ({
  auth: { currentUser: { getIdToken: jest.fn().mockResolvedValue('token-movil') } },
}));
describe('apiRequest móvil', () => {
  it('adjunta el ID token de Firebase', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    await apiRequest('GET', '/auth/me', z.object({ ok: z.boolean() }));
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-movil');
  });
});
