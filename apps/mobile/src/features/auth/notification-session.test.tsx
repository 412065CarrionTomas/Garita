import { act, render } from '@testing-library/react-native';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { apiGet } from '@/lib/api-client';
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
  ApiError: class ApiError extends Error {},
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
