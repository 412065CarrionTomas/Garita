import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { APIProvider, Map as GoogleMap, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { env } from '@/config/env';
import type { PointStatus } from '@/components/point-path';
import { cn } from '@/lib/utils';
import { mapStyle, useDark } from './map-style';

export interface LiveMapSite {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Texto del sello, ej. "3/8". */
  label: string;
  /** Lectura completa del sello para lectores de pantalla, ej. "3 de 8 ventanas completas". */
  description: string;
  /** late = demora (ámbar); off = sin señal (punteado y gris). */
  state: 'normal' | 'late' | 'off';
}

export interface LiveMapPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: PointStatus;
}

export interface LiveMapProps {
  sites: LiveMapSite[];
  selectedSiteId?: string | null;
  hoveredSiteId?: string | null;
  onSelectSite?: (id: string) => void;
  onHoverSite?: (id: string | null) => void;
  /** Puntos de la ronda seleccionada, en orden; se unen con la ruta. */
  points?: LiveMapPoint[];
  selectedPointId?: string | null;
  onSelectPoint?: (id: string) => void;
}

const POINT_LABEL: Record<PointStatus, string> = {
  done: 'Registrado',
  next: 'Próximo',
  missed: 'Sin registro',
  pending: 'Pendiente',
};

/** Marcador HTML sobre el mapa (no usa mapId: el estilo es JSON local y los marcadores avanzados lo exigen). */
function Overlay({
  lat,
  lng,
  zIndex,
  children,
}: {
  lat: number;
  lng: number;
  zIndex?: number;
  children: ReactNode;
}) {
  const map = useMap();
  const maps = useMapsLibrary('maps');
  const [anchor] = useState(() => {
    const el = document.createElement('div');
    el.style.position = 'absolute';
    return el;
  });
  useEffect(() => {
    Object.assign(anchor.style, { zIndex: String(zIndex ?? 0) });
  }, [anchor, zIndex]);
  useEffect(() => {
    if (!map || !maps) return;
    const overlay = new maps.OverlayView();
    overlay.onAdd = () => {
      overlay.getPanes()?.overlayMouseTarget.appendChild(anchor);
    };
    overlay.draw = () => {
      // getProjection() es undefined hasta que el overlay se agrega; los tipos no lo reflejan.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const pixel = overlay.getProjection()?.fromLatLngToDivPixel({ lat, lng });
      if (!pixel) return;
      anchor.style.left = `${pixel.x}px`;
      anchor.style.top = `${pixel.y}px`;
    };
    overlay.onRemove = () => {
      anchor.remove();
    };
    overlay.setMap(map);
    return () => {
      overlay.setMap(null);
    };
  }, [map, maps, anchor, lat, lng]);
  return createPortal(children, anchor);
}

const SITE_TONE = {
  normal: 'border-foreground text-foreground',
  late: 'border-warning text-warning',
  off: 'border-dashed border-muted-foreground text-muted-foreground',
};

/** Predio: contorno punteado (sólido si está seleccionado) y sello rectangular "hechos/total" con tallo. */
function SiteMarker({
  site,
  selected,
  hovered,
  dimmed,
  onSelect,
  onHover,
}: {
  site: LiveMapSite;
  selected: boolean;
  hovered: boolean;
  dimmed: boolean;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
}) {
  const strong = selected || hovered;
  return (
    <div
      className={cn('absolute top-0 left-0', dimmed && 'opacity-50')}
      onMouseEnter={() => onHover?.(site.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => onSelect?.(site.id)}
        className={cn(
          'absolute top-0 left-0 size-16 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-sm bg-foreground/5',
          SITE_TONE[site.state],
          selected ? 'border-solid bg-foreground/10' : 'border-dashed',
          strong ? 'border-[3px]' : 'border-[1.5px]',
        )}
      />
      <button
        type="button"
        aria-label={`${site.name}: ${site.description}`}
        aria-pressed={selected}
        onClick={() => onSelect?.(site.id)}
        className="absolute bottom-0 left-0 flex -translate-x-1/2 cursor-pointer flex-col items-center"
      >
        <span
          className={cn(
            'font-cond bg-card px-2 py-0.5 text-lg leading-tight font-bold tracking-wide tabular-nums',
            SITE_TONE[site.state],
            strong ? 'border-[3px]' : 'border-2',
          )}
        >
          {site.label}
        </span>
        <span aria-hidden="true" className={cn('h-2.5 w-0.5 bg-current', SITE_TONE[site.state])} />
      </button>
    </div>
  );
}

/** Punto de control: cuadrado de 12 px. Lleno = registrado; doble borde y mayor = próximo; borde rojo con cruz = falta. */
function PointMarker({
  point,
  index,
  selected,
  onSelect,
}: {
  point: LiveMapPoint;
  index: number;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const labelled = selected || point.status === 'next';
  return (
    <button
      type="button"
      aria-label={`Punto ${index + 1}, ${point.name}: ${POINT_LABEL[point.status]}`}
      aria-pressed={selected}
      onClick={() => onSelect?.(point.id)}
      className="absolute top-0 left-0 grid size-6 -translate-1/2 cursor-pointer place-items-center"
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid place-items-center border-2',
          point.status === 'next'
            ? 'size-4.5 outline-1 outline-offset-2 outline-foreground'
            : 'size-3',
          point.status === 'missed' ? 'border-danger bg-card' : 'border-foreground',
          point.status === 'done' ? 'bg-foreground' : 'bg-card',
          selected && 'border-[3.5px]',
        )}
      >
        {point.status === 'missed' && (
          <svg viewBox="0 0 8 8" className="size-2 fill-none stroke-danger" strokeWidth="1.6">
            <path d="M1 1l6 6M7 1L1 7" />
          </svg>
        )}
      </span>
      {labelled && (
        <span
          aria-hidden="true"
          className="font-cond absolute top-full -mt-1 rounded-xs bg-card/85 px-1 text-xs font-semibold text-foreground"
        >
          {index + 1}
        </span>
      )}
    </button>
  );
}

/** Ruta: sólida hasta donde se llegó, punteada lo que falta (mismo criterio que el camino lineal). */
function RoutePath({ points, dark }: { points: LiveMapPoint[]; dark: boolean }) {
  const map = useMap();
  const maps = useMapsLibrary('maps');
  useEffect(() => {
    if (!map || !maps || points.length < 2) return;
    // Los tokens son hex en :root/.dark; se leen del documento para no repetir colores acá.
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--foreground').trim();
    const muted = css.getPropertyValue('--muted-foreground').trim();
    const lines = points.flatMap((to, i) => {
      const from = points[i - 1];
      if (!from) return [];
      const path = [from, to].map((p) => ({ lat: p.lat, lng: p.lng }));
      const solid = to.status === 'done' || to.status === 'missed';
      return [
        new maps.Polyline({
          map,
          path,
          strokeColor: solid ? ink : muted,
          strokeWeight: solid ? 2.2 : 1.5,
          strokeOpacity: solid ? 1 : 0,
          icons: solid
            ? undefined
            : [
                {
                  icon: {
                    path: 'M 0,-1 0,1',
                    strokeOpacity: 1,
                    strokeColor: muted,
                    scale: 1.5,
                  },
                  offset: '0',
                  repeat: '10px',
                },
              ],
        }),
      ];
    });
    return () => {
      lines.forEach((line) => {
        line.setMap(null);
      });
    };
  }, [map, maps, points, dark]);
  return null;
}

function Controls({ onFit }: { onFit: () => void }) {
  const map = useMap();
  const zoom = (delta: number) => {
    map?.setZoom((map.getZoom() ?? 14) + delta);
  };
  const base =
    'grid h-10 min-w-10 place-items-center rounded-md border-[1.5px] border-primary bg-card text-xl font-semibold text-foreground hover:bg-muted';
  return (
    <div className="absolute top-3.5 right-3.5 z-10 grid gap-1.5">
      <button
        type="button"
        aria-label="Acercar"
        className={base}
        onClick={() => {
          zoom(1);
        }}
      >
        +
      </button>
      <button
        type="button"
        aria-label="Alejar"
        className={base}
        onClick={() => {
          zoom(-1);
        }}
      >
        −
      </button>
      <button type="button" className={cn(base, 'px-3 text-[13px]')} onClick={onFit}>
        Ver todo
      </button>
    </div>
  );
}

function MapContent({
  sites,
  selectedSiteId,
  hoveredSiteId,
  onSelectSite,
  onHoverSite,
  points = [],
  selectedPointId,
  onSelectPoint,
  dark,
}: LiveMapProps & { dark: boolean }) {
  const map = useMap();
  const selected = sites.find((site) => site.id === selectedSiteId);
  const targets = useMemo(
    () => (points.length ? points : selected ? [selected] : sites),
    [points, selected, sites],
  );
  // Clave por posición: un refetch con los mismos puntos no debe volver a encuadrar el mapa.
  const key = targets.map((t) => `${t.lat},${t.lng}`).join('|');
  const fit = useCallback(() => {
    const [only, ...rest] = targets;
    if (!map || !only) return;
    if (rest.length === 0) {
      map.panTo({ lat: only.lat, lng: only.lng });
      map.setZoom(17);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    targets.forEach((t) => {
      bounds.extend({ lat: t.lat, lng: t.lng });
    });
    map.fitBounds(bounds, 72);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  useEffect(fit, [fit]);

  return (
    <>
      <RoutePath points={points} dark={dark} />
      {sites.map((site) => (
        <Overlay
          key={site.id}
          lat={site.lat}
          lng={site.lng}
          zIndex={site.id === selectedSiteId ? 3 : site.id === hoveredSiteId ? 2 : 1}
        >
          <SiteMarker
            site={site}
            selected={site.id === selectedSiteId}
            hovered={site.id === hoveredSiteId}
            dimmed={Boolean(selectedSiteId) && site.id !== selectedSiteId}
            onSelect={onSelectSite}
            onHover={onHoverSite}
          />
        </Overlay>
      ))}
      {points.map((point, index) => (
        <Overlay key={point.id} lat={point.lat} lng={point.lng} zIndex={4}>
          <PointMarker
            point={point}
            index={index}
            selected={point.id === selectedPointId}
            onSelect={onSelectPoint}
          />
        </Overlay>
      ))}
      <Controls onFit={fit} />
    </>
  );
}

/** Mapa de Google con estilo propio claro/oscuro, predios como sellos y la ruta de la ronda. */
export function LiveMapView(props: LiveMapProps) {
  const dark = useDark();
  return (
    <APIProvider apiKey={env.VITE_GOOGLE_MAPS_API_KEY}>
      <GoogleMap
        defaultCenter={{ lat: -31.4, lng: -64.18 }}
        defaultZoom={12}
        styles={mapStyle(dark)}
        disableDefaultUI
        gestureHandling="greedy"
        className="size-full"
      >
        <MapContent {...props} dark={dark} />
      </GoogleMap>
    </APIProvider>
  );
}
