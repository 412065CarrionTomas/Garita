import { act, render } from '@testing-library/react-native';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { ApiError, apiGet } from '@/lib/api-client';
import { registerGuardDevice, unregisterGuardDevice } from '@/features/notificaciones/guard-device';
import { AuthProvider, useAuth } from './auth-context';
import { dismissPanicNotification } from '@/features/panico/bloqueado/notification';
jest.mock('@/features/panico/bloqueado/notification', () => ({
  dismissPanicNotification: jest.fn(async () => undefined),
  recordLockedPanicFailure: jest.fn(),
}));

jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn(() => jest.fn()),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
}));
jest.mock('@/lib/firebase', () => ({
  auth: { currentUser: { uid: 'firebase-1', getIdToken: jest.fn(async () => 'token') } },
}));
jest.mock('@/lib/api-client', () => ({
  apiGet: jest.fn(),
  ApiError: class ApiError extends Error {
    readonly status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  },
}));
jest.mock('@/features/notificaciones/guard-device', () => ({
  registerGuardDevice: jest.fn(),
  unregisterGuardDevice: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  removeItem: jest.fn(),
  getItem: jest.fn(),
}));

describe('guard notification session', () => {
  let authContext: ReturnType<typeof useAuth>;
  function Consumer() {
    authContext = useAuth();
    return null;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(signInWithEmailAndPassword).mockResolvedValue({
      user: { uid: 'firebase-1', getIdToken: jest.fn(async () => 'token') },
    } as never);
    jest.mocked(apiGet).mockResolvedValue({ role: 'guard', allowedChannels: ['mobile'] } as never);
    jest.mocked(registerGuardDevice).mockResolvedValue(undefined);
    jest.mocked(unregisterGuardDevice).mockResolvedValue(undefined);
    jest.mocked(signOut).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    jest.mocked(unregisterGuardDevice).mockResolvedValue(undefined);
    await act(async () => {
      await authContext.logout();
    });
    jest.restoreAllMocks();
  });

  it.each([401, 403])('closes the session when unregistering responds %s', async (status) => {
    await render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );
    await act(async () => {
      await authContext.login('guard@example.test', 'password');
    });
    jest.mocked(unregisterGuardDevice).mockRejectedValue(new ApiError('denegado', status));
    await act(async () => {
      await authContext.logout();
    });
    expect(signOut).toHaveBeenCalled();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('garita:auth-profile:firebase-1');
    expect(authContext.user).toBeNull();
  });

  it('keeps the session and explains how to retry when unregistering fails offline', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );
    await act(async () => {
      await authContext.login('guard@example.test', 'password');
    });
    jest.mocked(unregisterGuardDevice).mockRejectedValue(new TypeError('Network request failed'));
    await act(async () => {
      await authContext.logout();
    });
    expect(signOut).not.toHaveBeenCalled();
    expect(authContext.user).not.toBeNull();
    expect(alert).toHaveBeenCalledWith(
      'No se pudo cerrar sesión',
      expect.stringContaining('Conectate a internet'),
    );
  });

  it.each([401, 403])(
    'removes the cached profile and allows device registration after profile rejection %s',
    async (status) => {
      await render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>,
      );
      await act(async () => {
        await authContext.login('guard@example.test', 'password');
      });
      jest.mocked(apiGet).mockRejectedValueOnce(new ApiError('denegado', status));
      const listener = jest.mocked(onAuthStateChanged).mock.calls[0]![1];
      if (typeof listener !== 'function') throw new Error('Expected auth callback');
      await act(async () => {
        await listener({ uid: 'firebase-1', getIdToken: async () => 'token' } as User);
      });
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('garita:auth-profile:firebase-1');
      expect(authContext.user).toBeNull();
      await act(async () => {
        await authContext.login('guard@example.test', 'password');
      });
      expect(registerGuardDevice).toHaveBeenCalledTimes(2);
    },
  );

  it('registers on login and deletes the device before Firebase sign-out', async () => {
    await render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );
    await act(async () => {
      await authContext.login('guard@example.test', 'password');
    });
    expect(registerGuardDevice).toHaveBeenCalledTimes(1);
    await act(async () => {
      await authContext.logout();
    });
    expect(unregisterGuardDevice).toHaveBeenCalledTimes(1);
    expect(dismissPanicNotification).toHaveBeenCalledTimes(1);
    expect(jest.mocked(unregisterGuardDevice).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(signOut).mock.invocationCallOrder[0] ?? Infinity,
    );
  });
});
