import { lazy, Suspense } from 'react';
import type { LiveMapProps } from './live-map-view';

export type { LiveMapPoint, LiveMapProps, LiveMapSite } from './live-map-view';

const View = lazy(() => import('./live-map-view').then((m) => ({ default: m.LiveMapView })));

/** Mapa de supervisión, cargado en diferido para que MapLibre no entre al bundle inicial. */
export function LiveMap(props: LiveMapProps) {
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
