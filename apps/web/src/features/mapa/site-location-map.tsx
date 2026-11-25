import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Marker as MarkerInstance } from 'maplibre-gl';
import { Marker as MapMarker, useMap } from 'react-map-gl/maplibre';
import { AddressSearch } from './address-search';
import { BaseMap } from './base-map';
import { DEFAULT_CENTER, useDark, useMapStyle } from './map-style';

import { EmptyState } from '@/components/empty-state';
import { cn } from '@/lib/utils';
import type { Props as LocationProps } from './site-location';

type Props = Pick<LocationProps, 'latitude' | 'longitude' | 'onChange'>;

/** Marcador arrastrable; el mapa sigue al punto cuando cambia desde afuera. */
function DraggableMarker({ latitude, longitude, onChange }: Props) {
  const { current: map } = useMap();
  useEffect(() => {
    if (!map) return;
    map.easeTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 15) });
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

export function SiteMapLocation({
  unavailable,
  others = [],
  mapClassName,
  search = true,
  ...props
}: LocationProps & { unavailable?: ReactNode }) {
  // Misma consulta (en caché) que BaseMap: si el mapa no carga se reemplaza toda la sección.
  const { isError } = useMapStyle(useDark());
  if (isError) return unavailable;
  // Un predio nuevo llega con 0, 0 (en el océano): se arranca en la zona por defecto y sin marcador.
  const unset = props.latitude === 0 && props.longitude === 0;
  return (
    <section aria-label="Ubicación del predio" className="min-w-0 space-y-4">
      {search && (
        <>
          <AddressSearch onSelect={props.onChange} />
          <p className="text-sm text-muted-foreground">
            {unset
              ? 'Buscá la dirección o hacé clic en el mapa para ubicar el predio.'
              : 'Ajustá la ubicación arrastrando el marcador.'}
          </p>
        </>
      )}
      <div className={cn('h-72 overflow-hidden rounded-xl border border-border', mapClassName)}>
        <BaseMap
          initialViewState={
            unset
              ? { ...DEFAULT_CENTER, zoom: 11 }
              : { latitude: props.latitude, longitude: props.longitude, zoom: 16 }
          }
          onClick={(event) => {
            props.onChange(event.lngLat.lat, event.lngLat.lng);
          }}
        >
          {/* Los demás, como puntos chicos y apagados: el marcador grande es el que se mueve. */}
          {others.map((other) => (
            <MapMarker
              key={other.id}
              latitude={Number(other.latitude)}
              longitude={Number(other.longitude)}
            >
              <span
                title={other.name}
                className="relative block size-3 rounded-full border-2 border-card bg-muted-foreground"
              >
                {other.label && (
                  <span className="absolute top-full left-1/2 mt-0.5 -translate-x-1/2 rounded-sm bg-card px-1 text-[10px] leading-tight font-semibold text-foreground tabular-nums">
                    {other.label}
                  </span>
                )}
              </span>
            </MapMarker>
          ))}
          {!unset && <DraggableMarker {...props} />}
        </BaseMap>
      </div>
    </section>
  );
}

export interface ClientSitesMapProps {
  sites: {
    id: string;
    name: string;
    latitude: number | string;
    longitude: number | string;
    /** Rótulo chico bajo el marcador (por ejemplo, el número del punto). */
    label?: ReactNode;
    /** Se puede arrastrar; mientras se arrastra avisa con `onMove` (su rótulo lo acompaña). */
    draggable?: boolean;
  }[];
  /** Alto en px (por ejemplo, lo que queda de la ventana); sin esto, una franja fija. */
  height?: number;
  /** Mantener apretado un marcador 300 ms. */
  onHold?: (id: string) => void;
  onMove?: (id: string, latitude: number, longitude: number) => void;
}

const HOLD_MS = 300;

/** Pin por defecto de MapLibre; avisa si se lo mantiene apretado sin moverlo. */
function Pin({
  id,
  latitude,
  longitude,
  draggable,
  onHold,
  onMove,
}: {
  id: string;
  latitude: number;
  longitude: number;
  draggable?: boolean;
  onHold?: (id: string) => void;
  onMove?: (id: string, latitude: number, longitude: number) => void;
}) {
  const ref = useRef<MarkerInstance>(null);
  useEffect(() => {
    const element = ref.current?.getElement();
    if (!element || !onHold) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let startX = 0;
    let startY = 0;
    const cancel = () => {
      clearTimeout(timer);
    };
    const down = (event: PointerEvent) => {
      // Solo el botón principal (o el dedo): el clic derecho no entra al modo edición.
      if (event.button !== 0) return;
      cancel();
      startX = event.clientX;
      startY = event.clientY;
      timer = setTimeout(() => {
        onHold(id);
      }, HOLD_MS);
    };
    // Si el dedo se corre, es un arrastre del mapa y no una pulsación larga.
    const move = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 6) cancel();
    };
    const ends = ['pointerup', 'pointerleave', 'pointercancel'] as const;
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    for (const name of ends) element.addEventListener(name, cancel);
    return () => {
      cancel();
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      for (const name of ends) element.removeEventListener(name, cancel);
    };
  }, [id, onHold]);
  return (
    <MapMarker
      ref={ref}
      latitude={latitude}
      longitude={longitude}
      draggable={draggable}
      onDrag={(event) => onMove?.(id, event.lngLat.lat, event.lngLat.lng)}
    />
  );
}

/** Uno o varios lugares con un marcador cada uno; con varios, encuadra todos al abrir. */
export function ClientSitesMap({ sites, height, onHold, onMove }: ClientSitesMapProps) {
  const points = sites.map((site) => ({
    id: site.id,
    lat: Number(site.latitude),
    lng: Number(site.longitude),
    label: site.label,
    draggable: site.draggable,
  }));
  const [first] = points;
  if (!first) return <EmptyState title="Este cliente no tiene predios activos." />;
  const lngs = points.map((p) => p.lng);
  const lats = points.map((p) => p.lat);
  return (
    <div
      style={{ height }}
      className={cn(
        'overflow-hidden rounded-xl border border-border',
        height === undefined && 'h-96',
      )}
    >
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
          <Pin
            key={point.id}
            id={point.id}
            latitude={point.lat}
            longitude={point.lng}
            draggable={point.draggable}
            onHold={onHold}
            onMove={onMove}
          />
        ))}
        {/* El número va en un marcador aparte, colgado justo debajo de la punta del pin. */}
        {points.map(
          (point) =>
            point.label !== undefined && (
              <MapMarker
                key={`${point.id}-label`}
                latitude={point.lat}
                longitude={point.lng}
                anchor="top"
              >
                <span className="block rounded-sm bg-card px-1 text-[10px] leading-tight font-semibold text-foreground tabular-nums">
                  {point.label}
                </span>
              </MapMarker>
            ),
        )}
      </BaseMap>
    </div>
  );
}
