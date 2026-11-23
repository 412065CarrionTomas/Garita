import { useCallback, useState } from 'react';
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

  const mutation = useMutation({
    mutationFn: (ids: readonly string[]) =>
      apiPut(path, { ids: [...ids] }, favoritesInputSchema, favoritesResponseSchema),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<FavoritesResponse>(queryKey);
      queryClient.setQueryData<FavoritesResponse>(queryKey, { ids: [...ids] });
      return { previous };
    },
    onError: (_error, _ids, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
      setNotice((current) =>
        current ? { ...current, failed: true, message: 'No pudimos guardar el cambio.' } : null,
      );
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKey, saved);
    },
  });

  const ids = query.data?.ids ?? NO_IDS;
  const { mutate } = mutation;
  const update = useCallback(
    (next: readonly string[], message: string) => {
      if (next.length > MAX_FAVORITES) return;
      setNotice({ message, failed: false, previous: ids });
      mutate(next);
    },
    [ids, mutate],
  );

  return {
    ids,
    loading: query.isPending,
    full: ids.length >= MAX_FAVORITES,
    update,
    notice: notice && { message: notice.message, failed: notice.failed },
    undo: () => {
      if (!notice) return;
      setNotice(null);
      if (!notice.failed) mutate(notice.previous);
    },
    dismiss: () => {
      setNotice(null);
    },
  };
}
