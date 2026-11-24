import type { LngLat, RoundRoute, RouteInput } from '@garita/shared';
import { useEffect, useMemo, useState } from 'react';
import { Layer, Marker, useMap } from 'react-map-gl/maplibre';
import { cn } from '@/lib/utils';
import { BaseMap } from '../mapa/base-map';
import { RouteLayers } from '../mapa/live-map-view';
import { DEFAULT_CENTER, useDark } from '../mapa/map-style';
import { routeEdits } from './route-draft';

export interface RouteEditorPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/** Mano: elegir y arrastrar. Encadenar: sumar puntos en orden. Paso y quiebre: marcar en el mapa. */
export type RouteTool = 'hand' | 'chain' | 'waypoint' | 'bend';

export interface RouteSection {
  l: number;
  s: number;
}

export interface RouteEditorProps {
  /** Todos los puntos del predio con ubicación; los de la ronda llevan su número de orden. */
  points: RouteEditorPoint[];
  /** Puntos de la ronda en orden. */
  selected: string[];
  route: RouteInput;
  /** Lo que se dibuja: el recorrido calculado o el borrador. */
  display: RoundRoute;
  active: RouteSection | null;
  focusId: string | null;
  tool: RouteTool;
  onPointClick: (id: string) => void;
  onLineClick: (section: RouteSection, at: LngLat) => void;
  onMapClick: (at: LngLat) => void;
  onRouteChange: (route: RouteInput) => void;
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
    // Solo al cambiar qué puntos hay: reordenar o mover un paso no debe mover la cámara.
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

/** Mapa del editor del recorrido: la lista de la izquierda es la alternativa sin mouse. */
export function RouteEditorView({
  points,
  selected,
  route,
  display,
  active,
  focusId,
  tool,
  onPointClick,
  onLineClick,
  onMapClick,
  onRouteChange,
}: RouteEditorProps) {
  const dark = useDark();
  const [overLine, setOverLine] = useState(false);
  // El tramo elegido va en el azul informativo para separarse de la ruta en tinta.
  const [ink, info] = useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    return ['--foreground', '--info'].map((token) => css.getPropertyValue(token).trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);
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
  const marking = tool !== 'hand';
  const stop = (event: { originalEvent: MouseEvent }) => {
    event.originalEvent.stopPropagation();
  };

  return (
    <BaseMap
      initialViewState={{ ...DEFAULT_CENTER, zoom: 15 }}
      cooperativeGestures={false}
      interactiveLayerIds={[HIT]}
      cursor={marking ? 'crosshair' : overLine ? 'pointer' : undefined}
      onMouseEnter={() => {
        setOverLine(true);
      }}
      onMouseLeave={() => {
        setOverLine(false);
      }}
      onClick={(event) => {
        const at: LngLat = [event.lngLat.lng, event.lngLat.lat];
        const props = event.features?.[0]?.properties as
          { leg?: number; section?: number } | undefined;
        if (props?.leg !== undefined && props.section !== undefined)
          onLineClick({ l: props.leg, s: props.section }, at);
        else onMapClick(at);
      }}
    >
      <FitPoints
        points={inRoute.length ? inRoute : points}
        line={display.legs.flatMap((leg) => leg.sections.flatMap((section) => section.geometry))}
      />
      <FollowFocus point={points.find((p) => p.id === focusId)} />
      <RouteLayers points={layerPoints} routes={routes} dark={dark} showWaypoints={false} />
      {active && (
        <Layer
          id="route-active"
          type="line"
          source="route"
          filter={['all', ['==', ['get', 'leg'], active.l], ['==', ['get', 'section'], active.s]]}
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
          paint={{ 'line-color': info, 'line-width': 7 }}
        />
      )}
      {/* Franja invisible y ancha para que la línea sea fácil de tocar. */}
      <Layer
        id={HIT}
        type="line"
        source="route"
        paint={{ 'line-color': ink, 'line-opacity': 0, 'line-width': 22 }}
      />
      {route.legs.map((leg, l) => (
        <span key={`leg-${String(l)}`}>
          {leg.waypoints.map(([lng, lat], k) => (
            <Marker
              key={`wp-${String(l)}-${String(k)}`}
              latitude={lat}
              longitude={lng}
              anchor="center"
              draggable
              onClick={stop}
              onDragEnd={(event) => {
                onRouteChange(
                  routeEdits.moveWaypoint(route, l, k, [event.lngLat.lng, event.lngLat.lat]),
                );
              }}
            >
              <span
                title="Punto de paso: arrastralo para moverlo, clic derecho lo borra"
                onContextMenu={(event) => {
                  event.preventDefault();
                  onRouteChange(routeEdits.removeWaypoint(route, l, k));
                }}
                className={cn(
                  'block size-3.5 rotate-45 cursor-grab border-2 bg-card',
                  active?.l === l ? 'border-foreground' : 'border-muted-foreground',
                )}
              />
            </Marker>
          ))}
          {leg.sections.flatMap((section, s) =>
            section.via.map(([lng, lat], i) => (
              <Marker
                key={`via-${String(l)}-${String(s)}-${String(i)}`}
                latitude={lat}
                longitude={lng}
                anchor="center"
                draggable
                onClick={stop}
                onDragEnd={(event) => {
                  onRouteChange(
                    routeEdits.moveVia(route, l, s, i, [event.lngLat.lng, event.lngLat.lat]),
                  );
                }}
              >
                <span
                  title="Quiebre: arrastralo para moverlo, clic derecho lo borra"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onRouteChange(routeEdits.removeVia(route, l, s, i));
                  }}
                  className="block size-2.5 cursor-grab rounded-full border-2 border-foreground bg-card"
                />
              </Marker>
            )),
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
            style={{ zIndex: order >= 0 ? 2 : 1 }}
            onClick={(event) => {
              stop(event);
              onPointClick(point.id);
            }}
          >
            {/* El mapa es un atajo con mouse: la lista de puntos ofrece lo mismo con teclado. */}
            <span
              aria-hidden="true"
              title={order >= 0 ? `${String(order + 1)}. ${point.name}` : point.name}
              className={cn(
                'font-cond grid cursor-pointer place-items-center border-2 font-semibold tabular-nums',
                order >= 0
                  ? 'size-6 border-foreground bg-card text-xs text-foreground'
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
