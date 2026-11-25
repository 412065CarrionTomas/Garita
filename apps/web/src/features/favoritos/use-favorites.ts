import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  favoritesInputSchema,
  favoritesResponseSchema,
  MAX_FAVORITES,
  type FavoriteEntityType,
  type FavoritesResponse,
  type ViewKey,
} from '@garita/shared';
import { apiGet, apiPut } from '@/lib/api-client';

/** Referencia estable mientras carga: evita recrear callbacks en cada render. */
const NO_IDS: readonly string[] = [];

export const favoritesQueryKey = (view: ViewKey, type: FavoriteEntityType) =>
  ['favorites', view, type] as const;

export interface FavoritesState {
  /** Ids fijados en orden; vacío mientras carga. */
  ids: readonly string[];
  loading: boolean;
  /** Ya se leyó lo guardado: antes de eso cambiar la lista pisaría los fijados reales. */
  ready: boolean;
  full: boolean;
  /** Guarda la lista nueva al instante; `message` describe el cambio para el aviso y deshacer. */
  update: (next: readonly string[], message: string) => void;
  /** Último cambio, para mostrarlo con "Deshacer"; null si no hay. */
  notice: { message: string; failed: boolean } | null;
  undo: () => void;
  dismiss: () => void;
}

/**
 * Elementos fijados de una pantalla (se guardan al instante, sin el botón Guardar del diseño).
 * Actualización optimista: la lista cambia enseguida y, si la API falla, vuelve a la anterior y
 * el aviso lo dice. Cada cambio se puede deshacer una vez.
 */
export function useFavorites(view: ViewKey, type: FavoriteEntityType): FavoritesState {
  const queryClient = useQueryClient();
  const queryKey = favoritesQueryKey(view, type);
  const path = `/mis-favoritos/${view}/${type}`;
  const query = useQuery({
    queryKey,
    queryFn: () => apiGet(path, favoritesResponseSchema),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [notice, setNotice] = useState<{
    message: string;
    failed: boolean;
    previous: readonly string[];
  } | null>(null);

  // Los PUT de una misma lista van en fila (scope): llegan a la base en el orden en que se hicieron.
  // Cada uno lleva su número y solo el último decide la caché y el aviso: si un PUT viejo falla
  // pero el siguiente guarda, lo que quedó es lo del siguiente.
  const sequence = useRef(0);
  const mutation = useMutation({
    scope: { id: path },
    mutationFn: ({ ids }: { ids: readonly string[]; seq: number }) =>
      apiPut(path, { ids: [...ids] }, favoritesInputSchema, favoritesResponseSchema),
    onMutate: async ({ ids }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<FavoritesResponse>(queryKey);
      queryClient.setQueryData<FavoritesResponse>(queryKey, { ids: [...ids] });
      return { previous };
    },
    onError: (_error, { seq }, context) => {
      if (seq !== sequence.current) return;
      // Lo anterior puede ser otro cambio optimista que tampoco se guardó: se vuelve a leer la base.
      queryClient.setQueryData(queryKey, context?.previous);
      void queryClient.invalidateQueries({ queryKey });
      // Aunque el aviso ya no esté (p. ej. al deshacer), la falla se muestra.
      setNotice((current) => ({
        previous: current?.previous ?? NO_IDS,
        failed: true,
        message: 'No pudimos guardar el cambio.',
      }));
    },
    onSuccess: (saved, { seq }) => {
      if (seq === sequence.current) queryClient.setQueryData(queryKey, saved);
    },
  });

  const ids = query.data?.ids ?? NO_IDS;
  const ready = query.isSuccess;
  const { mutate } = mutation;
  const save = useCallback(
    (next: readonly string[]) => {
      sequence.current += 1;
      mutate({ ids: next, seq: sequence.current });
    },
    [mutate],
  );
  const update = useCallback(
    (next: readonly string[], message: string) => {
      if (!ready || next.length > MAX_FAVORITES) return;
      setNotice({ message, failed: false, previous: ids });
      save(next);
    },
    [ids, ready, save],
  );

  return {
    ids,
    loading: query.isPending,
    ready,
    full: ids.length >= MAX_FAVORITES,
    update,
    notice: notice && { message: notice.message, failed: notice.failed },
    undo: () => {
      if (!notice) return;
      setNotice(null);
      if (!notice.failed) save(notice.previous);
    },
    dismiss: () => {
      setNotice(null);
    },
  };
}
