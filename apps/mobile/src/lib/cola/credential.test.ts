import {
  deleteShiftCredential,
  getShiftCredential,
  getShiftCredentialToken,
  resetCredentialStoreForTesting,
  saveShiftCredential,
  setCredentialStoreForTesting,
} from './credential';

describe('shift credential storage', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    setCredentialStoreForTesting({
      setItem: async (k, v) => {
        store.set(k, v);
      },
      getItem: async (k) => store.get(k) ?? null,
      deleteItem: async (k) => {
        store.delete(k);
      },
    });
  });

  afterEach(() => {
    resetCredentialStoreForTesting();
  });

  it('saves and retrieves valid shift credential', async () => {
    const cred = {
      token: 'jwt-shift-token-12345',
      expiresAt: '2026-10-21T18:00:00.000Z',
    };

    await saveShiftCredential(cred);
    const retrieved = await getShiftCredential();
    expect(retrieved).toEqual(cred);
    expect(await getShiftCredentialToken()).toBe('jwt-shift-token-12345');
  });

  it('returns null if no credential is saved', async () => {
    expect(await getShiftCredential()).toBeNull();
    expect(await getShiftCredentialToken()).toBeNull();
  });

  it('deletes stored shift credential', async () => {
    const cred = {
      token: 'jwt-shift-token-12345',
      expiresAt: '2026-10-21T18:00:00.000Z',
    };
    await saveShiftCredential(cred);
    expect(await getShiftCredentialToken()).toBe('jwt-shift-token-12345');

    await deleteShiftCredential();
    expect(await getShiftCredential()).toBeNull();
    expect(await getShiftCredentialToken()).toBeNull();
  });

  it('rejects invalid credential schema', async () => {
    await expect(
      saveShiftCredential({
        token: '',
        expiresAt: 'invalid-date',
      } as never),
    ).rejects.toThrow();
  });
});
