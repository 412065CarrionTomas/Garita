import { useEffect, useState } from 'react';
import { z } from 'zod';
import {
  guardShiftSchema,
  guardShiftsPageSchema,
  type GuardShift,
  type GuardShiftsPage,
} from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { loadError, readCached, writeCached, type LoadError } from '@/lib/cached-get';
import { auth } from '@/lib/firebase';
import type { DayRange } from './shift-range';

interface Loaded {
  key: string;
  shifts: GuardShift[];
  done: boolean;
  error: LoadError;
  savedAt: string | null;
}

const cachedSchema = z.object({
  desde: z.string(),
  hasta: z.string(),
  shifts: z.array(guardShiftSchema),
});

/**
 * Turnos del vigilador en un rango. Trae las páginas en orden y muestra cada una apenas llega;
 * si cambia el rango, descarta lo que seguía en vuelo. Mientras recarga conserva la lista previa
 * (la pantalla la recorta al rango vigente). Guarda el último rango completo para verlo sin señal.
 */
export function useGuardShifts({ desde, hasta }: DayRange) {
  const [attempt, setAttempt] = useState(0);
  const key = `${desde}|${hasta}|${attempt}`;
  const [loaded, setLoaded] = useState<Loaded>({
    key: '',
    shifts: [],
    done: false,
    error: null,
    savedAt: null,
  });
  useEffect(() => {
    let active = true;
    const cacheKey = `cache:${auth.currentUser?.uid ?? 'anon'}:turnos`;
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
          setLoaded({ key, shifts, done: !cursor, error: null, savedAt: null });
        } while (cursor);
        void writeCached(cacheKey, { desde, hasta, shifts });
      } catch (cause) {
        const cached = await readCached(cacheKey, cachedSchema);
        if (!active) return;
        const usable = cached?.data.desde === desde && cached.data.hasta === hasta;
        setLoaded((prev) => ({
          key,
          shifts: usable ? cached.data.shifts : prev.shifts,
          done: true,
          error: loadError(cause),
          savedAt: usable ? cached.savedAt : null,
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
    savedAt: current ? loaded.savedAt : null,
    reload: () => setAttempt((n) => n + 1),
  };
}
