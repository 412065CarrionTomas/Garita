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
import { authMeResponseSchema } from '@garita/shared';
import type { AuthMeResponse } from '@garita/shared';
import { ApiError, apiGet } from '@/lib/api-client';
import { auth } from '@/lib/firebase';

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
};
const AuthContext = createContext<AuthContextValue | null>(null);
const profileKey = (uid: string) => `garita:auth-profile:${uid}`;

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
        } catch (reason) {
          if (reason instanceof ApiError && (reason.status === 401 || reason.status === 403)) {
            setError(firebaseErrorMessage(reason));
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
      return profile;
    } catch (reason) {
      if (reason instanceof AuthFlowError) throw reason;
      const message = firebaseErrorMessage(reason);
      setError(message);
      if (credential) await signOut(auth);
      throw new AuthFlowError(message);
    }
  }, []);
  const logout = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    await signOut(auth);
    if (uid) await AsyncStorage.removeItem(profileKey(uid));
    setUser(null);
  }, []);
  const recover = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  }, []);
  const value = useMemo(
    () => ({ user, loading, error, login, logout, recover }),
    [user, loading, error, login, logout, recover],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return value;
}
