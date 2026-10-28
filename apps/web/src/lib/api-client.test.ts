import { z } from 'zod';
import { apiRequest } from './api-client';

jest.mock('@/lib/firebase', () => ({
  auth: { currentUser: { getIdToken: jest.fn().mockResolvedValue('token-prueba') } },
}));
jest.mock('firebase/auth', () => ({ signOut: jest.fn() }));

describe('apiRequest', () => {
  it('adjunta el ID token y envía JSON con POST', async () => {
    let requestInit: RequestInit | undefined;
    const fetchMock: typeof fetch = (_input, init) => {
      requestInit = init;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      } as Response);
    };
    globalThis.fetch = fetchMock;
    await apiRequest('POST', '/usuarios', z.object({ ok: z.boolean() }), { name: 'Ana' });
    const headers = new Headers(requestInit?.headers);
    expect(headers.get('Authorization')).toBe('Bearer token-prueba');
    expect(requestInit?.method).toBe('POST');
    expect(requestInit?.body).toBe('{"name":"Ana"}');
  });
});
