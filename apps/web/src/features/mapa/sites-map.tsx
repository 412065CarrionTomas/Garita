import { lazy, Suspense } from 'react';
import type { ClientSitesMapProps } from './site-location-map';

const ClientSitesMap = lazy(() =>
  import('./site-location-map').then((module) => ({ default: module.ClientSitesMap })),
);

/** Mapa chico con marcadores, en diferido para que MapLibre no entre al bundle inicial. */
export function SitesMap(props: ClientSitesMapProps) {
  return (
    <Suspense fallback={<p role="status">Cargando mapa…</p>}>
      <ClientSitesMap {...props} />
    </Suspense>
  );
}
