import { lazy, Suspense } from 'react';
import { env } from '@/config/env';
import { EmptyState } from '@/components/empty-state';
import type { LiveMapProps } from './live-map-view';

export type { LiveMapPoint, LiveMapProps, LiveMapSite } from './live-map-view';

const View = lazy(() => import('./live-map-view').then((m) => ({ default: m.LiveMapView })));

/** Mapa de supervisión. Sin clave de Google Maps muestra un aviso en su lugar; el resto de la pantalla funciona igual. */
export function LiveMap(props: LiveMapProps) {
  if (!env.VITE_GOOGLE_MAPS_API_KEY)
    return (
      <div className="grid size-full place-items-center bg-muted p-6">
        <EmptyState
          title="Mapa no disponible"
          description="Falta configurar la clave de Google Maps."
          className="bg-card"
        />
      </div>
    );
  return (
    <Suspense
      fallback={
        <p role="status" className="p-4 text-sm">
          Cargando mapa…
        </p>
      }
    >
      <View {...props} />
    </Suspense>
  );
}
