import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { accountSuspendedResponseSchema } from '@garita/shared';
import { apiGet, ApiError } from './api-client';
import { auth } from './firebase';

export type LoadError = 'suspended' | 'failed' | null;

/** Error de carga para mostrar: la suspensión de la cuenta tiene su propio mensaje. */
export function loadError(cause: unknown): Exclude<LoadError, null> {
  return cause instanceof ApiError &&
    cause.status === 402 &&
    accountSuspendedResponseSchema.safeParse(cause.payload).success
    ? 'suspended'
    : 'failed';
}

const entrySchema = z.object({ savedAt: z.string(), data: z.unknown() });

/** Copia local por usuario: lo último que llegó de la API, para verlo sin señal. */
export async function readCached<T extends z.ZodType>(
  key: string,
  schema: T,
): Promise<{ savedAt: string; data: z.infer<T> } | null> {
  const raw = await AsyncStorage.getItem(key).catch(() => null);
  if (!raw) return null;
  try {
    const entry = entrySchema.safeParse(JSON.parse(raw));
    const data = entry.success ? schema.safeParse(entry.data.data) : null;
    return entry.success && data?.success ? { savedAt: entry.data.savedAt, data: data.data } : null;
  } catch {
    return null;
  }
}

export function writeCached(key: string, data: unknown) {
  return AsyncStorage.setItem(
    key,
    JSON.stringify({ savedAt: new Date().toISOString(), data }),
  ).catch(() => undefined);
}

/**
 * GET con copia local: muestra primero lo guardado y lo reemplaza cuando responde la API.
 * Sin señal queda lo guardado y `savedAt` dice de cuándo es.
 */
export function useCachedGet<T extends z.ZodType>(path: string, schema: T) {
  // Por usuario: en un celular compartido nadie ve la copia de otro.
  const key = `cache:${auth.currentUser?.uid ?? 'anon'}:${path}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    data: z.infer<T> | null;
    savedAt: string | null;
    loading: boolean;
    error: LoadError;
  }>({ data: null, savedAt: null, loading: true, error: null });
  useEffect(() => {
    let active = true;
    void (async () => {
      // La copia va primero (lectura local, rápida) para que sin señal no le gane el error.
      const cached = attempt === 0 ? await readCached(key, schema) : null;
      if (active && cached)
        setState((prev) => ({ ...prev, data: cached.data, savedAt: cached.savedAt }));
      try {
        const data = await apiGet(path, schema);
        if (!active) return;
        setState({ data, savedAt: null, loading: false, error: null });
        void writeCached(key, data);
      } catch (cause) {
        if (active) setState((prev) => ({ ...prev, loading: false, error: loadError(cause) }));
      }
    })();
    return () => {
      active = false;
    };
  }, [key, path, schema, attempt]);
  const reload = () => {
    setState((prev) => ({ ...prev, loading: true }));
    setAttempt((n) => n + 1);
  };
  return { ...state, reload };
}

const savedFormat = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });

/** Aviso de copia local: dice de cuándo es lo que se está viendo. */
export const cachedNotice = (savedAt: string) =>
  `Sin conexión. Mostrando lo guardado el ${savedFormat.format(new Date(savedAt))}.`;
