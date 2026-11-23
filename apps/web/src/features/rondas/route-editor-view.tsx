import { useMutation } from '@tanstack/react-query';
import {
  ROUTE_LIMITS,
  roundRoutePreviewInputSchema,
  roundRoutePreviewResponseSchema,
  sectionEndpoints,
  polyline,
  staleLegs,
  type LngLat,
  type RoundRoute,
  type RouteInput,
  type RouteMode,
} from '@garita/shared';
import { useEffect, useMemo, useState } from 'react';
import { Marker, useMap } from 'react-map-gl/maplibre';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { BaseMap } from '../mapa/base-map';
import { RouteLayers } from '../mapa/live-map-view';
import { DEFAULT_CENTER, useDark } from '../mapa/map-style';
import { failedLegs, failureMessages, legLabel, routeEdits, sectionMidpoint } from './route-draft';

export interface RouteEditorPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface RouteEditorProps {
  siteId: string;
  /** Puntos de la ronda en el orden elegido en el formulario. */
  points: RouteEditorPoint[];
  route: RouteInput;
  onChange: (route: RouteInput) => void;
  onClosedChange: (closed: boolean) => void;
  /** Recorrido guardado de la ronda que se edita, si es para estos mismos puntos. */
  savedRoute?: RoundRoute | null;
}

const MODES: { mode: RouteMode; label: string }[] = [
  { mode: 'streets', label: 'Por calles' },
  { mode: 'manual', label: 'A mano' },
];

/** Lo que se dibuja sin calcular: rectas, y las secciones por calles marcadas como pendientes. */
function draftGeometry(route: RouteInput, coords: LngLat[]): RoundRoute {
  const first = coords[0];
  const ring = route.closed && first ? [...coords, first] : coords;
  return {
    v: 1,
    closed: route.closed,
    legs: route.legs.flatMap((leg, l) => {
      const from = ring[l];
      const to = ring[l + 1];
      if (!from || !to) return [];
      const ends = sectionEndpoints(from, to, leg.waypoints);
      return [
        {
          from,
          to,
          waypoints: leg.waypoints,
          sections: leg.sections.map((section, s) => {
            const [start, end] = ends[s] ?? [from, to];
            return {
              ...section,
              geometry: polyline(start, section.via, end),
              fallback: section.mode === 'streets',
            };
          }),
        },
      ];
    }),
  };
}

function FitPoints({ points }: { points: RouteEditorPoint[] }) {
  const { current: map } = useMap();
  const key = points.map((p) => `${String(p.lat)},${String(p.lng)}`).join('|');
  useEffect(() => {
    if (!map || points.length === 0) return;
    const lngs = points.map((p) => p.lng);
    const lats = points.map((p) => p.lat);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 56, maxZoom: 18, duration: 0 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

/** Editor del recorrido ideal: el mapa ayuda, pero todo se puede hacer desde la lista. */
export function RouteEditorView({
  siteId,
  points,
  route,
  onChange,
  onClosedChange,
  savedRoute,
}: RouteEditorProps) {
  const dark = useDark();
  const coords = useMemo(() => points.map((p): LngLat => [p.lng, p.lat]), [points]);
  const [active, setActive] = useState<{ l: number; s: number } | null>(null);
  const requestKey = JSON.stringify({ ids: points.map((p) => p.id), route });
  const calculate = useMutation({
    mutationFn: async () => {
      const result = await apiPost(
        '/rondas/ruteo-previsualizar',
        { siteId, checkpointIds: points.map((p) => p.id), route },
        roundRoutePreviewInputSchema,
        roundRoutePreviewResponseSchema,
      );
      return { ...result, key: requestKey };
    },
  });
  // Lo calculado vale mientras no se toque el recorrido; después se vuelve a ver el borrador.
  const calculated = calculate.data?.key === requestKey ? calculate.data : undefined;
  const display = calculated?.route ?? draftGeometry(route, coords);
  const failures = calculated?.failures ?? [];
  const failed = failedLegs(failures);
  const messages = failureMessages(failures, route.legs.length, route.closed);
  const stale = new Set(savedRoute ? staleLegs(savedRoute, coords) : []);
  const ids = points.map((p) => p.id);
  const mapPoints = useMemo(() => points.map((p) => ({ ...p, status: 'done' as const })), [points]);
  const edit = (next: RouteInput) => {
    onChange(next);
  };
  const atMidpoint = (l: number, s: number, apply: (at: LngLat) => RouteInput) => {
    const at = sectionMidpoint(route, coords, l, s);
    if (at) edit(apply(at));
  };

  return (
    <section aria-labelledby="route-editor-title" className="grid gap-3">
      <h5 id="route-editor-title" className="font-medium">
        Recorrido
      </h5>
      <p className="text-sm text-muted-foreground">
        El camino que debería seguir el vigilador. Los puntos de control se mueven desde Puntos; acá
        se moldea el camino con puntos de paso (no se registran) y quiebres.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={route.closed}
          onChange={(event) => {
            onClosedChange(event.target.checked);
          }}
        />
        Volver al inicio
      </label>
      <div className="h-80 overflow-hidden rounded-md border border-border">
        <BaseMap
          initialViewState={{ ...DEFAULT_CENTER, zoom: 15 }}
          cooperativeGestures={false}
          cursor={active ? 'crosshair' : undefined}
          onClick={(event) => {
            if (!active) return;
            edit(
              routeEdits.addVia(route, active.l, active.s, [event.lngLat.lng, event.lngLat.lat]),
            );
          }}
        >
          <FitPoints points={points} />
          <RouteLayers
            points={mapPoints}
            routes={[{ checkpointIds: ids, route: display }]}
            dark={dark}
            showWaypoints={false}
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
                  onDragEnd={(event) => {
                    edit(
                      routeEdits.moveWaypoint(route, l, k, [event.lngLat.lng, event.lngLat.lat]),
                    );
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="block size-3 rotate-45 cursor-grab border-2 border-muted-foreground bg-card"
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
                    onDragEnd={(event) => {
                      edit(
                        routeEdits.moveVia(route, l, s, i, [event.lngLat.lng, event.lngLat.lat]),
                      );
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="block size-2 cursor-grab rounded-full border-[1.5px] border-foreground bg-card"
                    />
                  </Marker>
                )),
              )}
            </span>
          ))}
          {points.map((point, index) => (
            <Marker key={point.id} latitude={point.lat} longitude={point.lng} anchor="center">
              <span
                aria-hidden="true"
                className="font-cond grid size-5 place-items-center border-2 border-foreground bg-card text-xs font-semibold text-foreground"
              >
                {index + 1}
              </span>
            </Marker>
          ))}
        </BaseMap>
      </div>
      {active && (
        <p role="status" className="text-sm">
          Tocá el mapa para agregar en el tramo{' '}
          {legLabel(active.l, route.legs.length, route.closed)}. Arrastrá los puntos para moverlos.
        </p>
      )}
      <ol className="grid gap-3" aria-label="Tramos del recorrido">
        {route.legs.map((leg, l) => {
          const label = legLabel(l, route.legs.length, route.closed);
          return (
            <li key={`tramo-${String(l)}`} className="grid gap-2 border-b border-border pb-3">
              <h6 className="font-cond text-base font-semibold uppercase tracking-wider">
                Tramo {label}
              </h6>
              {failed.has(l) && (
                <p className="text-sm text-danger">
                  <span aria-hidden="true">✕ </span>No se pudo calcular por calles.
                </p>
              )}
              {stale.has(l) && (
                <p className="flex flex-wrap items-center gap-2 text-sm text-warning">
                  El punto se movió desde que se trazó este tramo.
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      calculate.mutate();
                    }}
                  >
                    Recalcular
                  </Button>
                </p>
              )}
              {leg.waypoints.length > 0 && (
                <ol className="grid gap-1" aria-label={`Puntos de paso del tramo ${label}`}>
                  {leg.waypoints.map((_, k) => (
                    <li key={`wp-${String(k)}`} className="flex items-center gap-2 text-sm">
                      <span aria-hidden="true">◇</span> Punto de paso {k + 1}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          edit(routeEdits.removeWaypoint(route, l, k));
                        }}
                      >
                        Quitar punto de paso {k + 1}
                      </Button>
                    </li>
                  ))}
                </ol>
              )}
              {leg.sections.map((section, s) => {
                const isActive = active?.l === l && active.s === s;
                const part = leg.sections.length > 1 ? ` (parte ${String(s + 1)})` : '';
                const noun = section.mode === 'manual' ? 'quiebre' : 'punto intermedio';
                return (
                  <div key={`sec-${String(s)}`} className="grid gap-2 pl-3">
                    <div
                      role="group"
                      aria-label={`Modo del tramo ${label}${part}`}
                      className="flex w-fit overflow-hidden rounded-md border-[1.5px] border-primary"
                    >
                      {MODES.map(({ mode, label: modeLabel }) => (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={section.mode === mode}
                          className={cn(
                            'h-8 px-3 text-sm font-semibold text-foreground hover:bg-muted',
                            section.mode === mode &&
                              'bg-primary text-primary-foreground hover:bg-primary',
                          )}
                          onClick={() => {
                            edit(routeEdits.setMode(route, l, s, mode));
                          }}
                        >
                          {modeLabel}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-pressed={isActive}
                        onClick={() => {
                          setActive(isActive ? null : { l, s });
                        }}
                      >
                        {isActive ? 'Dejar de marcar en el mapa' : 'Marcar en el mapa'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={section.via.length >= ROUTE_LIMITS.viaPerSection}
                        onClick={() => {
                          atMidpoint(l, s, (at) => routeEdits.addVia(route, l, s, at));
                        }}
                      >
                        Agregar {noun}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={section.via.length === 0}
                        onClick={() => {
                          edit(routeEdits.undoVia(route, l, s));
                        }}
                      >
                        Deshacer último
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={section.via.length === 0}
                        onClick={() => {
                          edit(routeEdits.clearVia(route, l, s));
                        }}
                      >
                        Borrar trazado
                      </Button>
                      <span className="self-center text-sm text-muted-foreground tabular-nums">
                        {section.via.length}{' '}
                        {section.mode === 'manual' ? 'quiebres' : 'intermedios'}
                      </span>
                    </div>
                  </div>
                );
              })}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={leg.waypoints.length >= ROUTE_LIMITS.waypointsPerLeg}
                onClick={() => {
                  const last = leg.sections.length - 1;
                  atMidpoint(l, last, (at) => routeEdits.addWaypoint(route, l, at));
                }}
              >
                Agregar punto de paso al tramo {label}
              </Button>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={calculate.isPending || route.legs.length === 0}
          onClick={() => {
            calculate.mutate();
          }}
        >
          {calculate.isPending ? 'Calculando…' : 'Calcular recorrido'}
        </Button>
        {calculated && messages.length === 0 && (
          <p role="status" className="text-sm">
            Recorrido calculado por calles.
          </p>
        )}
      </div>
      {calculate.isError && (
        <Alert variant="destructive" role="alert">
          No se pudo calcular el recorrido. Revisá los datos y reintentá. Tu recorrido no se
          modificó.
        </Alert>
      )}
      {messages.length > 0 && (
        <Alert variant="destructive" role="alert" aria-label="Fallas del recorrido">
          {messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
          <p>Tu recorrido no se modificó: corregí y volvé a calcular.</p>
        </Alert>
      )}
    </section>
  );
}
