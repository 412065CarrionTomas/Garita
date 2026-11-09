import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sitesResponseSchema } from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { env } from '@/config/env';

/**
 * Coordenadas de los predios para el mapa. La lista y el detalle de turnos no las traen, así que
 * se leen de /predios (misma consulta que la pantalla de Predios). Sin mapa configurado no se pide.
 */
export function useSiteCoordinates() {
  const { data } = useQuery({
    queryKey: ['predios'],
    queryFn: () => apiGet('/predios', sitesResponseSchema),
    enabled: Boolean(env.VITE_GOOGLE_MAPS_API_KEY),
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
