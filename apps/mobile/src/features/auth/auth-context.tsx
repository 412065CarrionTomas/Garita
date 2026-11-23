import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  authMeResponseSchema,
  emptyResponseSchema,
  LEGAL_VERSION,
  legalAcceptanceRequestSchema,
} from '@garita/shared';
import type { AuthMeResponse } from '@garita/shared';
import { Alert } from 'react-native';
import { ApiError, apiGet, apiRequest } from '@/lib/api-client';
import { auth } from '@/lib/firebase';
import { registerGuardDevice, unregisterGuardDevice } from '@/features/notificaciones/guard-device';
import {
  dismissPanicNotification,
  recordLockedPanicFailure,
} from '@/features/panico/bloqueado/notification';

export const DISABLED_MESSAGE =
  'Tu usuario no está habilitado. Si recibiste una invitación, activala desde el enlace del correo; si no, contactá a tu administrador';
export const CLIENT_MESSAGE = 'Tu usuario se usa desde el panel web de Garita';
export const RESET_MESSAGE =
  'Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña';
export class AuthFlowError extends Error {}

export function firebaseErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code === 'auth/user-disabled' || (error instanceof ApiError && error.status === 403))
    return DISABLED_MESSAGE;
  if (code === 'auth/too-many-requests')
    return 'Demasiados intentos. Esperá un momento antes de volver a intentarlo.';
  if (code.startsWith('auth/')) return 'Correo o contraseña incorrectos';
  return 'No pudimos iniciar sesión. Revisá tu conexión e intentá nuevamente.';
}
type AuthContextValue = {
  user: AuthMeResponse | null;
  loading: boolean;
  error: string;
  login(email: string, password: string): Promise<AuthMeResponse>;
  logout(): Promise<void>;
  recover(email: string): Promise<void>;
  acceptLegal(): Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);
const profileKey = (uid: string) => `garita:auth-profile:${uid}`;
let registeredUid: string | null = null;

function registerForUser(uid: string) {
  if (registeredUid === uid) return;
  registeredUid = uid;
  void registerGuardDevice();
}

async function profileFor(user: FirebaseUser) {
  await user.getIdToken();
  return apiGet('/auth/me', authMeResponseSchema);
}

async function cachedProfile(uid: string): Promise<AuthMeResponse | null> {
  try {
    const stored = await AsyncStorage.getItem(profileKey(uid));
    if (!stored) return null;
    const parsed = authMeResponseSchema.safeParse(JSON.parse(stored) as unknown);
    return parsed.success &&
      parsed.data.allowedChannels.includes('mobile') &&
      parsed.data.role !== 'client'
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(
    () =>
      onAuthStateChanged(auth, async (firebaseUser) => {
        if (!firebaseUser) {
          await dismissPanicNotification().catch(recordLockedPanicFailure);
          setUser(null);
          setLoading(false);
          return;
        }
        try {
          const profile = await profileFor(firebaseUser);
          if (!profile.allowedChannels.includes('mobile') || profile.role === 'client') {
            setError(CLIENT_MESSAGE);
            await signOut(auth);
            setUser(null);
            return;
          }
          await AsyncStorage.setItem(profileKey(firebaseUser.uid), JSON.stringify(profile));
          setUser(profile);
          if (profile.role === 'guard') registerForUser(firebaseUser.uid);
        } catch (reason) {
          if (reason instanceof ApiError && (reason.status === 401 || reason.status === 403)) {
            setError(firebaseErrorMessage(reason));
            registeredUid = null;
            setUser(null);
            await AsyncStorage.removeItem(profileKey(firebaseUser.uid));
            await signOut(auth);
          } else setUser(await cachedProfile(firebaseUser.uid));
        } finally {
          setLoading(false);
        }
      }),
    [],
  );
  const login = useCallback(async (email: string, password: string) => {
    setError('');
    let credential;
    try {
      credential = await signInWithEmailAndPassword(auth, email, password);
      const profile = await profileFor(credential.user);
      if (!profile.allowedChannels.includes('mobile') || profile.role === 'client') {
        await signOut(auth);
        throw new AuthFlowError(CLIENT_MESSAGE);
      }
      await AsyncStorage.setItem(profileKey(credential.user.uid), JSON.stringify(profile));
      setUser(profile);
      if (profile.role === 'guard') registerForUser(credential.user.uid);
      return profile;
    } catch (reason) {
      if (reason instanceof AuthFlowError) throw reason;
      const message = firebaseErrorMessage(reason);
      setError(message);
      if (
        credential &&
        reason instanceof ApiError &&
        (reason.status === 401 || reason.status === 403)
      ) {
        registeredUid = null;
        setUser(null);
        await AsyncStorage.removeItem(profileKey(credential.user.uid));
      }
      if (credential) await signOut(auth);
      throw new AuthFlowError(message);
    }
  }, []);
  const logout = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    try {
      await unregisterGuardDevice();
    } catch (reason) {
      if (!(reason instanceof ApiError && (reason.status === 401 || reason.status === 403))) {
        Alert.alert(
          'No se pudo cerrar sesión',
          'Conectate a internet para dar de baja las notificaciones de este celular y volvé a intentarlo.',
        );
        return;
      }
    }
    await signOut(auth);
    await dismissPanicNotification().catch(recordLockedPanicFailure);
    registeredUid = null;
    if (uid) await AsyncStorage.removeItem(profileKey(uid));
    setUser(null);
  }, []);
  const recover = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  }, []);
  const acceptLegal = useCallback(async () => {
    await apiRequest(
      'POST',
      '/auth/terminos',
      emptyResponseSchema,
      legalAcceptanceRequestSchema.parse({ version: LEGAL_VERSION }),
    );
    const uid = auth.currentUser?.uid;
    if (!user) return;
    const accepted = { ...user, legalAcceptanceRequired: false };
    if (uid)
      await AsyncStorage.setItem(profileKey(uid), JSON.stringify(accepted)).catch(() => undefined);
    setUser(accepted);
  }, [user]);
  const value = useMemo(
    () => ({ user, loading, error, login, logout, recover, acceptLegal }),
    [user, loading, error, login, logout, recover, acceptLegal],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return value;
}
