import { useEffect, useState } from 'react';
import {
  accountSuspendedResponseSchema,
  guardShiftsPageSchema,
  type GuardShift,
  type GuardShiftsPage,
} from '@garita/shared';
import { apiGet, ApiError } from '@/lib/api-client';
import type { DayRange } from './shift-range';

export type LoadError = 'suspended' | 'failed' | null;

interface Loaded {
  key: string;
  shifts: GuardShift[];
  done: boolean;
  error: LoadError;
}

/**
 * Turnos del vigilador en un rango. Trae las páginas en orden y muestra cada una apenas llega;
 * si cambia el rango, descarta lo que seguía en vuelo. Mientras recarga conserva la lista previa
 * (la pantalla la recorta al rango vigente).
 */
export function useGuardShifts({ desde, hasta }: DayRange) {
  const [attempt, setAttempt] = useState(0);
  const key = `${desde}|${hasta}|${attempt}`;
  const [loaded, setLoaded] = useState<Loaded>({ key: '', shifts: [], done: false, error: null });
  useEffect(() => {
    let active = true;
    void (async () => {
      let cursor: string | null = null;
      let shifts: GuardShift[] = [];
      try {
        do {
          const query: URLSearchParams = new URLSearchParams({ desde, hasta });
          if (cursor) query.set('cursor', cursor);
          const page: GuardShiftsPage = await apiGet(
            `/mis-turnos/rango?${query}`,
            guardShiftsPageSchema,
          );
          if (!active) return;
          shifts = [...shifts, ...page.items];
          cursor = page.nextCursor;
          setLoaded({ key, shifts, done: !cursor, error: null });
        } while (cursor);
      } catch (cause) {
        if (!active) return;
        const suspended =
          cause instanceof ApiError &&
          cause.status === 402 &&
          accountSuspendedResponseSchema.safeParse(cause.payload).success;
        setLoaded((prev) => ({
          ...prev,
          key,
          done: true,
          error: suspended ? 'suspended' : 'failed',
        }));
      }
    })();
    return () => {
      active = false;
    };
  }, [desde, hasta, key]);
  const current = loaded.key === key;
  return {
    shifts: loaded.shifts,
    loading: !current || !loaded.done,
    error: current ? loaded.error : null,
    reload: () => setAttempt((n) => n + 1),
  };
}
