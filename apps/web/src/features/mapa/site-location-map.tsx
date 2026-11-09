import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Marker as MapMarker, useMap } from 'react-map-gl/maplibre';
import { AddressSearch } from './address-search';
import { BaseMap } from './base-map';
import { useDark, useMapStyle } from './map-style';

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

export interface ClientSitesMapProps {
  sites: { id: string; name: string; latitude: number | string; longitude: number | string }[];
}

/** Uno o varios lugares con un marcador cada uno; con varios, encuadra todos al abrir. */
export function ClientSitesMap({ sites }: ClientSitesMapProps) {
  const points = sites.map((site) => ({
    id: site.id,
    lat: Number(site.latitude),
    lng: Number(site.longitude),
  }));
  const [first] = points;
  if (!first) return <EmptyState title="Este cliente no tiene predios activos." />;
  const lngs = points.map((p) => p.lng);
  const lats = points.map((p) => p.lat);
  return (
    <div className="h-96 overflow-hidden rounded-xl border border-border">
      <BaseMap
        initialViewState={
          points.length === 1
            ? { latitude: first.lat, longitude: first.lng, zoom: 15 }
            : {
                bounds: [
                  [Math.min(...lngs), Math.min(...lats)],
                  [Math.max(...lngs), Math.max(...lats)],
                ],
                fitBoundsOptions: { padding: 48, maxZoom: 16 },
              }
        }
      >
        {points.map((point) => (
          <MapMarker key={point.id} latitude={point.lat} longitude={point.lng} />
        ))}
      </BaseMap>
    </div>
  );
}
