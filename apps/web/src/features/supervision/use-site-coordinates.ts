import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sitesResponseSchema } from '@garita/shared';
import { apiGet } from '@/lib/api-client';

/**
 * Coordenadas de los predios para el mapa. La lista y el detalle de turnos no las traen, así que
 * se leen de /predios (misma consulta que la pantalla de Predios).
 */
export function useSiteCoordinates() {
  const { data } = useQuery({
    queryKey: ['predios'],
    queryFn: () => apiGet('/predios', sitesResponseSchema),
  });
  return useMemo(
    () =>
      new Map(
        (data ?? []).flatMap((site) => {
          const lat = Number(site.latitude);
          const lng = Number(site.longitude);
          return Number.isFinite(lat) && Number.isFinite(lng)
            ? [[site.id, { lat, lng }] as const]
            : [];
        }),
      ),
    [data],
  );
}
