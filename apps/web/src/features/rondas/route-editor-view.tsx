import type { LngLat, RoundRoute, RouteInput } from '@garita/shared';
import { useEffect, useMemo, useState } from 'react';
import { Layer, Marker, useMap } from 'react-map-gl/maplibre';
import { cn } from '@/lib/utils';
import { BaseMap } from '../mapa/base-map';
import { RouteLayers } from '../mapa/live-map-view';
import { DEFAULT_CENTER, useDark } from '../mapa/map-style';
import { GuideMark, ModeChangeMark } from '../mapa/route-legend';
import { partKey, routeEdits } from './route-draft';

export interface RouteEditorPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/** Seleccionar (y arrastrar) o sumar puntos de control tocándolos en orden. */
export type RouteTool = 'select' | 'chain';

/** Lo elegido: una parte de un tramo, un punto de guía, un cambio de modo o un punto de control. */
export type RouteSelection =
  | { kind: 'part'; l: number; s: number }
  | { kind: 'via'; l: number; s: number; i: number }
  | { kind: 'waypoint'; l: number; k: number }
  | { kind: 'point'; id: string };

export interface RouteEditorProps {
  /** Todos los puntos del predio con ubicación; los de la ronda llevan su número de orden. */
  points: RouteEditorPoint[];
  /** Puntos de la ronda en orden. */
  selected: string[];
  route: RouteInput;
  /** Lo que se dibuja: lo calculado de cada parte o su recta. */
  display: RoundRoute;
  selection?: RouteSelection | null;
  tool?: RouteTool;
  onSelect?: (selection: RouteSelection | null) => void;
  onPointClick?: (id: string) => void;
  /** Clic sobre la línea de la parte elegida: sumar un punto de guía ahí. */
  onAddVia?: (l: number, s: number, at: LngLat) => void;
  /** Partes cuyos puntos de guía muestran su número (clave `partKey`). */
  numbered?: ReadonlySet<string>;
  /** Sin esto el mapa es de solo lectura. */
  onRouteChange?: (route: RouteInput) => void;
}

const HIT = 'route-hit';

/**
 * Encuadra los puntos de la ronda (o todos, si todavía no tiene) y la línea dibujada, al abrir y al
 * sumar o quitar puntos.
 */
function FitPoints({ points, line }: { points: RouteEditorPoint[]; line: LngLat[] }) {
  const { current: map } = useMap();
  const key = points.map((p) => p.id).join('|');
  useEffect(() => {
    if (!map || points.length === 0) return;
    const lngs = [...points.map((p) => p.lng), ...line.map(([lng]) => lng)];
    const lats = [...points.map((p) => p.lat), ...line.map(([, lat]) => lat)];
    // El contenedor pudo cambiar de alto después de crear el mapa: se mide antes de encuadrar.
    map.resize();
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 72, maxZoom: 18, duration: 0 },
    );
    // Solo al cambiar qué puntos hay: reordenar o mover un punto no debe mover la cámara.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key.split('|').sort().join('|')]);
  return null;
}

/** Centra el punto elegido desde la lista. */
function FollowFocus({ point }: { point?: RouteEditorPoint }) {
  const { current: map } = useMap();
  useEffect(() => {
    if (map && point) map.easeTo({ center: [point.lng, point.lat], duration: 300 });
  }, [map, point]);
  return null;
}

/**
 * Mapa del editor del recorrido, pensado para mouse: tocar una línea elige su parte; sobre la
 * parte elegida, un clic suma un punto de guía donde está el punto fantasma; los puntos se
 * arrastran y el clic derecho los elimina. La lista y la barra de abajo ofrecen lo mismo sin mapa.
 */
export function RouteEditorView({
  points,
  selected,
  route,
  display,
  selection = null,
  tool = 'select',
  numbered,
  onSelect,
  onPointClick,
  onAddVia,
  onRouteChange,
}: RouteEditorProps) {
  const dark = useDark();
  const [overLine, setOverLine] = useState(false);
  const [ghost, setGhost] = useState<LngLat | null>(null);
  const ink = useMemo(
    () => getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dark],
  );
  const inRoute = useMemo(() => {
    const byId = new Map(points.map((p) => [p.id, p]));
    return selected.flatMap((id) => {
      const point = byId.get(id);
      return point ? [point] : [];
    });
  }, [points, selected]);
  const layerPoints = useMemo(
    () => inRoute.map((p) => ({ ...p, status: 'done' as const })),
    [inRoute],
  );
  const routes = useMemo(() => [{ checkpointIds: selected, route: display }], [selected, display]);
  const editable = Boolean(onRouteChange);
  const part =
    selection?.kind === 'part' || selection?.kind === 'via'
      ? { l: selection.l, s: selection.s }
      : null;
  const focusId = selection?.kind === 'point' ? selection.id : null;
  const stop = (event: { originalEvent: MouseEvent }) => {
    event.originalEvent.stopPropagation();
  };
  const lineAt = (props: { leg?: number; section?: number } | null | undefined) =>
    props?.leg !== undefined && props.section !== undefined
      ? { l: props.leg, s: props.section }
      : null;

  return (
    <BaseMap
      initialViewState={{ ...DEFAULT_CENTER, zoom: 15 }}
      cooperativeGestures={false}
      interactiveLayerIds={[HIT]}
      cursor={tool === 'chain' ? 'crosshair' : ghost ? 'copy' : overLine ? 'pointer' : undefined}
      onMouseEnter={() => {
        setOverLine(true);
      }}
      onMouseLeave={() => {
        setOverLine(false);
        setGhost(null);
      }}
      onMouseMove={(event) => {
        const over = lineAt(event.features?.[0]?.properties);
        const onPart = editable && part && over?.l === part.l && over.s === part.s;
        setGhost(onPart ? [event.lngLat.lng, event.lngLat.lat] : null);
      }}
      onClick={(event) => {
        const at: LngLat = [event.lngLat.lng, event.lngLat.lat];
        const over = lineAt(event.features?.[0]?.properties);
        if (!over) {
          if (tool === 'select') onSelect?.(null);
          return;
        }
        if (editable && part?.l === over.l && part.s === over.s) onAddVia?.(over.l, over.s, at);
        else onSelect?.({ kind: 'part', ...over });
      }}
    >
      <FitPoints
        points={inRoute.length ? inRoute : points}
        line={display.legs.flatMap((leg) => leg.sections.flatMap((section) => section.geometry))}
      />
      <FollowFocus point={points.find((p) => p.id === focusId)} />
      <RouteLayers points={layerPoints} routes={routes} dark={dark} editor={editable} />
      {part && (
        // Halo de la parte elegida, debajo de la línea para no tapar su patrón.
        <Layer
          id="route-active"
          type="line"
          source="route"
          beforeId="route-casing"
          filter={['all', ['==', ['get', 'leg'], part.l], ['==', ['get', 'section'], part.s]]}
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
          paint={{ 'line-color': ink, 'line-width': 12, 'line-opacity': 0.22 }}
        />
      )}
      {/* Franja invisible y ancha para que la línea sea fácil de tocar. */}
      <Layer
        id={HIT}
        type="line"
        source="route"
        paint={{ 'line-color': ink, 'line-opacity': 0, 'line-width': 22 }}
      />
      {ghost && (
        <Marker latitude={ghost[1]} longitude={ghost[0]} anchor="center" style={{ zIndex: 1 }}>
          <span aria-hidden="true" className="pointer-events-none block opacity-70">
            <GuideMark />
          </span>
        </Marker>
      )}
      {route.legs.map((leg, l) => (
        <span key={`leg-${String(l)}`}>
          {leg.waypoints.map(([lng, lat], k) => {
            const chosen = selection?.kind === 'waypoint' && selection.l === l && selection.k === k;
            return (
              <Marker
                key={`wp-${String(l)}-${String(k)}`}
                latitude={lat}
                longitude={lng}
                anchor="center"
                draggable={editable}
                style={{ zIndex: 4 }}
                onClick={(event) => {
                  stop(event);
                  onSelect?.({ kind: 'waypoint', l, k });
                }}
                onDragEnd={(event) => {
                  onRouteChange?.(
                    routeEdits.moveWaypoint(route, l, k, [event.lngLat.lng, event.lngLat.lat]),
                  );
                }}
              >
                <span
                  aria-hidden="true"
                  title="Cambio de modo: arrastralo para moverlo; clic derecho lo elimina"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (editable) onRouteChange?.(routeEdits.removeWaypoint(route, l, k));
                  }}
                  className={cn(
                    'block p-1',
                    editable && 'cursor-grab',
                    chosen && 'outline-2 outline-foreground',
                  )}
                >
                  <ModeChangeMark
                    from={leg.sections[k]?.mode ?? 'streets'}
                    to={leg.sections[k + 1]?.mode ?? 'streets'}
                  />
                </span>
              </Marker>
            );
          })}
          {leg.sections.flatMap((section, s) =>
            section.via.map(([lng, lat], i) => {
              const chosen =
                selection?.kind === 'via' &&
                selection.l === l &&
                selection.s === s &&
                selection.i === i;
              return (
                <Marker
                  key={`via-${String(l)}-${String(s)}-${String(i)}`}
                  latitude={lat}
                  longitude={lng}
                  anchor="center"
                  draggable={editable}
                  style={{ zIndex: 4 }}
                  onClick={(event) => {
                    stop(event);
                    onSelect?.({ kind: 'via', l, s, i });
                  }}
                  onDragEnd={(event) => {
                    onRouteChange?.(
                      routeEdits.moveVia(route, l, s, i, [event.lngLat.lng, event.lngLat.lat]),
                    );
                  }}
                >
                  <span
                    aria-hidden="true"
                    title="Punto de guía: arrastralo para moverlo; clic derecho lo elimina"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (editable) onRouteChange?.(routeEdits.removeVia(route, l, s, i));
                    }}
                    className={cn(
                      'relative grid size-6 place-items-center rounded-full',
                      editable && 'cursor-grab',
                      chosen && 'outline-2 -outline-offset-2 outline-foreground',
                    )}
                  >
                    <GuideMark />
                    {numbered?.has(partKey(l, s)) && (
                      // Número chico debajo, distinto del de los puntos de control.
                      <span className="font-cond absolute top-full left-1/2 -mt-1 -translate-x-1/2 rounded-xs bg-card/85 px-0.5 text-[0.625rem] leading-none font-semibold text-foreground">
                        {i + 1}
                      </span>
                    )}
                  </span>
                </Marker>
              );
            }),
          )}
        </span>
      ))}
      {points.map((point) => {
        const order = selected.indexOf(point.id);
        const focused = point.id === focusId;
        return (
          <Marker
            key={point.id}
            latitude={point.lat}
            longitude={point.lng}
            anchor="center"
            style={{ zIndex: order >= 0 ? 5 : 1 }}
            onClick={(event) => {
              stop(event);
              onPointClick?.(point.id);
            }}
          >
            {/* El mapa es un atajo con mouse: la lista de puntos ofrece lo mismo con teclado. */}
            <span
              aria-hidden="true"
              title={order >= 0 ? `${String(order + 1)}. ${point.name}` : point.name}
              className={cn(
                'font-cond grid cursor-pointer place-items-center border-2 font-semibold tabular-nums',
                order >= 0
                  ? 'size-7 border-foreground bg-card text-sm text-foreground'
                  : 'size-3.5 border-muted-foreground bg-card',
                focused &&
                  'bg-primary text-primary-foreground outline-2 outline-offset-2 outline-foreground',
              )}
            >
              {order >= 0 ? order + 1 : ''}
            </span>
          </Marker>
        );
      })}
    </BaseMap>
  );
}
