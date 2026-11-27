import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  reconcileLayout,
  viewPreferenceResponseSchema,
  type LayoutItem,
  type ViewCatalog,
} from '@garita/shared';
import { apiGet } from '@/lib/api-client';

export const viewLayoutQueryKey = (key: string) => ['view-preferences', key] as const;

export const viewLayoutPath = (key: string) => `/mis-preferencias/vistas/${key}`;

/**
 * Diseño de la pantalla para el usuario: el guardado o, si no hay, el de defecto. Siempre se
 * reconcilia con el catálogo que trae esta versión de la web (la API puede ser más vieja o más
 * nueva). Si la lectura falla, se usa el de defecto y `failed` permite avisarlo.
 */
export function useViewLayout(catalog: ViewCatalog): {
  items: readonly LayoutItem[] | undefined;
  updatedAt: string | null;
  failed: boolean;
} {
  const query = useQuery({
    queryKey: viewLayoutQueryKey(catalog.key),
    queryFn: () => apiGet(viewLayoutPath(catalog.key), viewPreferenceResponseSchema),
    // Solo cambia cuando el propio usuario guarda; no hace falta volver a pedirlo.
    staleTime: Number.POSITIVE_INFINITY,
  });
  const stored = query.data?.layout;
  const failed = query.isError;
  const items = useMemo(() => {
    if (query.isPending) return undefined;
    return reconcileLayout(catalog, stored ?? catalog.defaultLayout).items;
  }, [catalog, stored, query.isPending]);
  return { items, updatedAt: query.data?.updatedAt ?? null, failed };
}
