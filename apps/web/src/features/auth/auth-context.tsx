/* eslint react-refresh/only-export-components: off */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
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
export const WEB_GUARD_MESSAGE = 'Tu usuario se usa desde la app móvil de Garita';
export const RESET_MESSAGE =
  'Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña';

export class AuthFlowError extends Error {}

export function firebaseErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code === 'auth/user-disabled') return DISABLED_MESSAGE;
  if (code === 'auth/too-many-requests')
    return 'Demasiados intentos. Esperá un momento antes de volver a intentarlo.';
  if (code.startsWith('auth/')) return 'Correo o contraseña incorrectos';
  if (error instanceof ApiError && error.status === 403) return DISABLED_MESSAGE;
  return 'No pudimos iniciar sesión. Revisá tu conexión e intentá nuevamente.';
}

interface AuthContextValue {
  user: AuthMeResponse | null;
  loading: boolean;
  error: string;
  login: (email: string, password: string) => Promise<AuthMeResponse>;
  logout: () => Promise<void>;
  recover: (email: string) => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadProfile(firebaseUser: FirebaseUser): Promise<AuthMeResponse> {
  await firebaseUser.getIdToken();
  return apiGet('/auth/me', authMeResponseSchema);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(
    () =>
      onAuthStateChanged(auth, (firebaseUser) => {
        void (async () => {
          if (!firebaseUser) {
            setUser(null);
            setLoading(false);
            return;
          }
          try {
            const profile = await loadProfile(firebaseUser);
            if (!profile.allowedChannels.includes('web') || profile.role === 'guard') {
              setError(WEB_GUARD_MESSAGE);
              await signOut(auth);
              setUser(null);
              return;
            }
            setUser(profile);
          } catch (reason) {
            const message = firebaseErrorMessage(reason);
            if (reason instanceof ApiError && (reason.status === 401 || reason.status === 403)) {
              setError(message);
              await signOut(auth);
            }
            setUser(null);
          } finally {
            setLoading(false);
          }
        })();
      }),
    [],
  );

  useEffect(() => {
    const handleAuthError = (event: Event) => {
      setError((event as CustomEvent<string>).detail);
      setUser(null);
    };
    window.addEventListener('garita:auth-error', handleAuthError);
    return () => {
      window.removeEventListener('garita:auth-error', handleAuthError);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError('');
    let credential;
    try {
      credential = await signInWithEmailAndPassword(auth, email, password);
      const profile = await loadProfile(credential.user);
      if (!profile.allowedChannels.includes('web') || profile.role === 'guard') {
        await signOut(auth);
        throw new AuthFlowError(WEB_GUARD_MESSAGE);
      }
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
    await signOut(auth);
    setUser(null);
  }, []);

  const recover = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      login,
      logout,
      recover,
      clearError: () => {
        setError('');
      },
    }),
    [user, loading, error, login, logout, recover],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return value;
}
