import { APIProvider, Map, Marker } from '@vis.gl/react-google-maps';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Marker as MapMarker, useMap } from 'react-map-gl/maplibre';
import { env } from '@/config/env';
import { AddressSearch } from './address-search';
import { BaseMap } from './base-map';
import { mapStyle, useDark, useMapStyle } from './map-style';

import { EmptyState } from '@/components/empty-state';

interface Props {
  latitude: number;
  longitude: number;
  onChange: (latitude: number, longitude: number) => void;
}

/** Marcador arrastrable; el mapa sigue al punto cuando cambia desde afuera. */
function DraggableMarker({ latitude, longitude, onChange }: Props) {
  const { current: map } = useMap();
  useEffect(() => {
    map?.panTo([longitude, latitude]);
  }, [latitude, longitude, map]);
  return (
    <MapMarker
      latitude={latitude}
      longitude={longitude}
      draggable
      onDragEnd={(event) => {
        onChange(event.lngLat.lat, event.lngLat.lng);
      }}
    />
  );
}

export function SiteMapLocation({ unavailable, ...props }: Props & { unavailable?: ReactNode }) {
  // Misma consulta (en caché) que BaseMap: si el mapa no carga se reemplaza toda la sección.
  const { isError } = useMapStyle(useDark());
  if (isError) return unavailable;
  return (
    <section aria-label="Ubicación del predio" className="min-w-0 space-y-4">
      <AddressSearch onSelect={props.onChange} />
      <p className="text-sm text-muted-foreground">
        Seleccioná la ubicación arrastrando el marcador.
      </p>
      <div className="h-72 overflow-hidden rounded-xl border border-border">
        <BaseMap
          initialViewState={{ latitude: props.latitude, longitude: props.longitude, zoom: 14 }}
        >
          <DraggableMarker {...props} />
        </BaseMap>
      </div>
    </section>
  );
}

export function ClientSitesMap({
  sites,
}: {
  sites: { id: string; name: string; latitude: number | string; longitude: number | string }[];
}) {
  const dark = useDark();
  if (sites.length === 0) return <EmptyState title="Este cliente no tiene predios activos." />;
  const firstSite = sites[0];
  if (!firstSite) return <EmptyState title="Este cliente no tiene predios activos." />;
  const position = (site: (typeof sites)[number]) => ({
    lat: Number(site.latitude),
    lng: Number(site.longitude),
  });
  return (
    <APIProvider apiKey={env.VITE_GOOGLE_MAPS_API_KEY}>
      <div className="h-96 overflow-hidden rounded-xl border border-border">
        <Map
          defaultCenter={position(firstSite)}
          defaultZoom={10}
          styles={mapStyle(dark)}
          className="h-96 w-full"
        >
          {sites.map((site) => (
            <Marker key={site.id} position={position(site)} title={site.name} />
          ))}
        </Map>
      </div>
    </APIProvider>
  );
}
