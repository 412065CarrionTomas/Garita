import { useMutation } from '@tanstack/react-query';
import {
  ROUTE_LIMITS,
  defaultGraceMinutes,
  defaultRouteInput,
  previewWindows,
  roundInputSchema,
  roundRoutePreviewInputSchema,
  roundRoutePreviewResponseSchema,
  roundRouteSchema,
  routeFailuresErrorSchema,
  staleLegs,
  type LngLat,
  type RouteFailure,
  type RouteInput,
  type RouteMode,
} from '@garita/shared';
import { ArrowLeft, ChevronDown, ChevronUp, GripVertical, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { SegmentedFilter } from '@/components/segmented-filter';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ApiError, apiPatch, apiPost } from '@/lib/api-client';
import { useBusy } from '@/lib/use-busy';
import { cn } from '@/lib/utils';
import { RouteEditor, type RouteSection, type RouteTool } from './route-editor';
import {
  draftGeometry,
  failedLegs,
  failureMessages,
  formatMeters,
  legLabel,
  legMeters,
  reconcileRoute,
  routeEdits,
  sectionMidpoint,
  sectionOptions,
  storedRouteInput,
  type RouteDraft,
} from './route-draft';

export interface EditorPoint {
  id: string;
  name: string;
  latitude?: number;
  longitude?: number;
}

export interface EditorRound {
  id: string;
  name: string;
  currentVersion: {
    frequencyMinutes: number;
    windowStartLocal: string;
    windowEndLocal: string;
    graceMinutes: number;
    route?: unknown;
    checkpoints: { checkpoint: { id: string } }[];
  } | null;
}

const TOOLS: { value: RouteTool; label: string }[] = [
  { value: 'hand', label: 'Mano' },
  { value: 'chain', label: 'Encadenar puntos' },
  { value: 'waypoint', label: 'Punto de paso' },
  { value: 'bend', label: 'Quiebre' },
];
const SHORTCUTS: Record<string, RouteTool> = {
  v: 'hand',
  e: 'chain',
  p: 'waypoint',
  q: 'bend',
  escape: 'hand',
};
const HINTS: Record<RouteTool, string> = {
  hand: 'Tocá una línea para elegir su tramo. Arrastrá los rombos (puntos de paso) y los círculos (quiebres) para moldear el camino; clic derecho los borra.',
  chain:
    'Tocá los puntos en el orden en que se recorren: se suman al final. Tocá el último para sacarlo.',
  waypoint:
    'Tocá una línea para poner un punto de paso ahí, o el mapa para sumarlo al tramo elegido. Obliga al camino a pasar por ese lugar, por ejemplo un portón.',
  bend: 'Tocá el mapa para agregar un quiebre al tramo elegido. A mano dibuja el camino; por calles lo obliga a pasar cerca.',
};
const MODES: { value: RouteMode; label: string }[] = [
  { value: 'streets', label: 'Por calles' },
  { value: 'manual', label: 'A mano' },
];
const idSchema = z.looseObject({ id: z.string() });

interface Snapshot {
  selected: string[];
  draft: RouteDraft;
}

/** Edición de una ronda: horario arriba, orden de puntos a la izquierda y el recorrido en el mapa. */
export function RoundEditor({
  siteId,
  points,
  round,
  sharedIds,
  onClose,
}: {
  siteId: string;
  points: EditorPoint[];
  round?: EditorRound;
  /** Puntos que ya están en otra ronda del predio. */
  sharedIds: Set<string>;
  /** Vuelve a la lista; con `message` si se guardó. */
  onClose: (message?: string) => void;
}) {
  const version = round?.currentVersion;
  const initialIds = version?.checkpoints.map(({ checkpoint }) => checkpoint.id) ?? [];
  const [name, setName] = useState(round?.name ?? '');
  const [frequency, setFrequency] = useState(version?.frequencyMinutes ?? 120);
  const [start, setStart] = useState(version?.windowStartLocal ?? '22:00');
  const [end, setEnd] = useState(version?.windowEndLocal ?? '06:00');
  const [grace, setGrace] = useState(version?.graceMinutes ?? 15);
  const [selected, setSelected] = useState(initialIds);
  const [draft, setDraft] = useState<RouteDraft>(() => ({
    ids: initialIds,
    route: storedRouteInput(version?.route) ?? defaultRouteInput(initialIds.length),
  }));
  const [past, setPast] = useState<Snapshot[]>([]);
  const [tool, setTool] = useState<RouteTool>('hand');
  const [picked, setPicked] = useState<RouteSection | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [routeFailures, setRouteFailures] = useState<RouteFailure[]>();
  const { busy, run } = useBusy();
  const sectionRef = useRef<HTMLElement>(null);

  // El recorrido sigue a la lista de puntos: conserva los tramos que no cambiaron.
  const route = reconcileRoute(draft, selected);
  const active =
    picked && route.legs[picked.l]?.sections[picked.s]
      ? picked
      : route.legs.length
        ? { l: 0, s: 0 }
        : null;

  const located = points.flatMap((p) =>
    p.latitude !== undefined && p.longitude !== undefined
      ? [{ id: p.id, name: p.name, lat: p.latitude, lng: p.longitude }]
      : [],
  );
  const locatedById = new Map(located.map((p) => [p.id, p]));
  const coords = selected.flatMap((id) => {
    const point = locatedById.get(id);
    return point ? [[point.lng, point.lat] as LngLat] : [];
  });
  const allLocated = coords.length === selected.length;
  const nameOf = (id: string) => points.find((p) => p.id === id)?.name ?? '';

  const requestKey = JSON.stringify({ selected, route });
  const calculate = useMutation({
    mutationFn: async () => {
      const result = await apiPost(
        '/rondas/ruteo-previsualizar',
        { siteId, checkpointIds: selected, route },
        roundRoutePreviewInputSchema,
        roundRoutePreviewResponseSchema,
      );
      return { ...result, key: requestKey };
    },
  });
  const savedRoute =
    initialIds.join() === selected.join()
      ? roundRouteSchema.safeParse(version?.route).data
      : undefined;
  // Lo calculado (o lo guardado, si no se tocó nada) vale hasta el próximo cambio; después se ve el borrador.
  const calculated =
    calculate.data?.key === requestKey
      ? calculate.data
      : savedRoute && JSON.stringify(storedRouteInput(savedRoute)) === JSON.stringify(route)
        ? { route: savedRoute, failures: [] }
        : undefined;
  const display = calculated?.route ?? draftGeometry(route, coords);
  const previewFailures = calculated?.failures ?? [];
  const failed = failedLegs(previewFailures);
  const previewMessages = failureMessages(previewFailures, route.legs.length, route.closed);
  const stale = new Set(savedRoute && allLocated ? staleLegs(savedRoute, coords) : []);
  const meters = legMeters(display);
  const total = meters.reduce((sum, m) => sum + m, 0);

  const labels = previewWindows({
    windowStartLocal: start,
    windowEndLocal: end,
    frequencyMinutes: frequency,
  });
  const scheduleError = Boolean(
    fieldErrors.frequencyMinutes ??
    fieldErrors.windowStartLocal ??
    fieldErrors.windowEndLocal ??
    fieldErrors.graceMinutes,
  );

  // Cada cambio del recorrido o de la lista se puede deshacer.
  const commit = (nextSelected: string[], nextRoute: RouteInput) => {
    setPast((items) => [...items.slice(-49), { selected, draft: { ids: selected, route } }]);
    setSelected(nextSelected);
    setDraft({ ids: nextSelected, route: nextRoute });
    setNotice('');
  };
  const editRoute = (next: RouteInput) => {
    commit(selected, next);
  };
  const setPoints = (next: string[]) => {
    commit(next, reconcileRoute({ ids: selected, route }, next));
  };
  const undo = () => {
    const last = past.at(-1);
    if (!last) return;
    setPast(past.slice(0, -1));
    setSelected(last.selected);
    setDraft(last.draft);
  };
  const addPoint = (id: string) => {
    setPoints([...selected, id]);
    setPicked({ l: Math.max(0, selected.length - 1), s: 0 });
  };
  const removePoint = (id: string) => {
    setPoints(selected.filter((item) => item !== id));
  };
  const moveTo = (id: string, index: number) => {
    const rest = selected.filter((item) => item !== id);
    if (rest.length === selected.length || index < 0 || index > rest.length) return;
    setPoints([...rest.slice(0, index), id, ...rest.slice(index)]);
  };
  const canAddWaypoint = (l: number) => {
    const ok = (route.legs[l]?.waypoints.length ?? 0) < ROUTE_LIMITS.waypointsPerLeg;
    if (!ok)
      setNotice(`Un tramo admite hasta ${String(ROUTE_LIMITS.waypointsPerLeg)} puntos de paso.`);
    return ok;
  };
  const canAddVia = ({ l, s }: RouteSection) => {
    const ok = (route.legs[l]?.sections[s]?.via.length ?? 0) < ROUTE_LIMITS.viaPerSection;
    if (!ok) setNotice(`Una sección admite hasta ${String(ROUTE_LIMITS.viaPerSection)} quiebres.`);
    return ok;
  };
  const insertWaypoint = (section: RouteSection, at: LngLat) => {
    if (!canAddWaypoint(section.l)) return;
    editRoute(routeEdits.insertWaypoint(route, section.l, section.s, at));
    setPicked({ l: section.l, s: section.s + 1 });
  };
  const addVia = (section: RouteSection, at: LngLat) => {
    if (!canAddVia(section)) return;
    editRoute(routeEdits.addVia(route, section.l, section.s, at));
    setPicked(section);
  };
  const atMidpoint = (section: RouteSection, apply: (at: LngLat) => void) => {
    const at = sectionMidpoint(route, coords, section.l, section.s);
    if (at) apply(at);
  };

  // El editor ocupa el alto de la ventana: se lo trae a la vista al abrir (jsdom no tiene scrollIntoView).
  useEffect(() => {
    const element = sectionRef.current;
    if (element && 'scrollIntoView' in element) element.scrollIntoView({ block: 'start' });
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, select, textarea, [contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const next = SHORTCUTS[event.key.toLowerCase()];
      if (next) setTool(next);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });

  // Armar una ronda larga lleva tiempo: salir sin guardar pide confirmación si hubo cambios.
  const dirty = past.length > 0 || name !== (round?.name ?? '');
  const leave = () => {
    if (dirty && !window.confirm('¿Descartar los cambios de la ronda?')) return;
    onClose();
  };
  const save = (allowStraight = false) => run(() => saveNow(allowStraight));
  const saveNow = async (allowStraight: boolean) => {
    const parsed = roundInputSchema.safeParse({
      name,
      checkpointIds: selected,
      frequencyMinutes: frequency,
      windowStartLocal: start,
      windowEndLocal: end,
      graceMinutes: grace,
      route,
      ...(allowStraight ? { allowStraight } : {}),
    });
    if (!parsed.success) {
      setFieldErrors(
        parsed.error.issues.reduce<Record<string, string[]>>((errors, issue) => {
          const field = String(issue.path[0] ?? 'form');
          // El mensaje genérico de zod para una lista vacía no le dice nada a quien arma la ronda.
          const text =
            field === 'checkpointIds' && issue.code === 'too_small'
              ? 'Sumá al menos un punto a la ronda.'
              : issue.message;
          errors[field] = [...(errors[field] ?? []), text];
          return errors;
        }, {}),
      );
      setMessage('');
      return;
    }
    setFieldErrors({});
    setRouteFailures(undefined);
    try {
      if (round) await apiPatch(`/rondas/${round.id}`, parsed.data, roundInputSchema, idSchema);
      else await apiPost(`/predios/${siteId}/rondas`, parsed.data, roundInputSchema, idSchema);
      onClose(
        round ? 'Ronda actualizada. Los cambios aplican a los turnos futuros.' : 'Ronda creada.',
      );
    } catch (error) {
      // El ruteo falló: no se guardó nada y el editor queda como estaba para reintentar.
      const routeError =
        error instanceof ApiError && error.status === 422
          ? routeFailuresErrorSchema.safeParse(error.body)
          : undefined;
      if (routeError?.success) {
        setRouteFailures(routeError.data.failures);
        setMessage('');
        return;
      }
      setMessage('No se pudo guardar la ronda. Verificá los puntos y el nombre.');
    }
  };

  const fieldError = (field: string, id: string) =>
    fieldErrors[field]?.map((error) => (
      <p className="text-sm text-danger" id={id} key={error}>
        {error}
      </p>
    ));
  const errorCount = Object.keys(fieldErrors).length;
  const matches = (id: string) =>
    !filter || nameOf(id).toLowerCase().includes(filter.toLowerCase());
  const outside = points.filter((p) => !selected.includes(p.id) && matches(p.id));
  const activeLeg = active ? route.legs[active.l] : undefined;
  const activeSection = active ? activeLeg?.sections[active.s] : undefined;
  const activeOption = active
    ? sectionOptions(route).find((o) => o.l === active.l && o.s === active.s)
    : undefined;

  return (
    <section
      ref={sectionRef}
      aria-labelledby="round-editor-title"
      className="flex h-[calc(100dvh-4.5rem)] min-h-[36rem] scroll-mt-16 flex-col overflow-hidden rounded-md border border-border bg-card"
    >
      <form
        id="round-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3"
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            leave();
          }}
        >
          <ArrowLeft aria-hidden="true" />
          Rondas
        </Button>
        <h3 id="round-editor-title" className="t-headline self-center">
          {round ? 'Editar ronda' : 'Nueva ronda'}
        </h3>
        <div className="grid min-w-56 gap-1.5">
          <Label htmlFor="round-name">Nombre</Label>
          <Input
            id="round-name"
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? 'round-name-error' : undefined}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            required
          />
          {fieldError('name', 'round-name-error')}
        </div>
        <details
          className="relative"
          open={scheduleOpen || scheduleError}
          onToggle={(event) => {
            setScheduleOpen(event.currentTarget.open);
          }}
        >
          <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-md border-[1.5px] border-input px-3 hover:bg-muted [&::-webkit-details-marker]:hidden">
            <span className="t-stamp tabular-nums">
              {start === end ? 'Todo el día' : `${start}–${end}`} · cada {frequency} min ·{' '}
              {labels.length} ventanas
            </span>
            <ChevronDown aria-hidden="true" className="size-4" />
            <span className="sr-only">Horario de la ronda</span>
          </summary>
          <div className="absolute top-12 left-0 z-20 grid w-[min(36rem,90vw)] gap-3 rounded-md border-[1.5px] border-primary bg-card p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="grid gap-1.5">
                <Label htmlFor="round-frequency">Frecuencia (minutos)</Label>
                <Input
                  id="round-frequency"
                  aria-invalid={Boolean(fieldErrors.frequencyMinutes)}
                  aria-describedby={
                    fieldErrors.frequencyMinutes ? 'round-frequency-error' : undefined
                  }
                  type="number"
                  min="15"
                  max="1440"
                  value={frequency}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setFrequency(next);
                    setGrace(defaultGraceMinutes(next));
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="round-start">Inicio de franja</Label>
                <Input
                  id="round-start"
                  aria-invalid={Boolean(fieldErrors.windowStartLocal)}
                  aria-describedby={fieldErrors.windowStartLocal ? 'round-start-error' : undefined}
                  type="time"
                  value={start}
                  onChange={(event) => {
                    setStart(event.target.value);
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="round-end">Fin de franja</Label>
                <Input
                  id="round-end"
                  aria-invalid={Boolean(fieldErrors.windowEndLocal)}
                  aria-describedby={fieldErrors.windowEndLocal ? 'round-end-error' : undefined}
                  type="time"
                  value={end}
                  onChange={(event) => {
                    setEnd(event.target.value);
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="round-grace">Gracia (minutos)</Label>
                <Input
                  id="round-grace"
                  aria-invalid={Boolean(fieldErrors.graceMinutes)}
                  aria-describedby={
                    fieldErrors.graceMinutes ? 'round-grace-error' : 'round-grace-help'
                  }
                  type="number"
                  min="0"
                  max="60"
                  value={grace}
                  onChange={(event) => {
                    setGrace(Number(event.target.value));
                  }}
                />
              </div>
            </div>
            <p id="round-grace-help" className="text-sm text-muted-foreground">
              Gracia predeterminada {defaultGraceMinutes(frequency)} min, máximo{' '}
              {Math.min(60, frequency / 2)}.{start === end && ' Todo el día (24 h).'}
            </p>
            {fieldError('frequencyMinutes', 'round-frequency-error')}
            {fieldError('windowStartLocal', 'round-start-error')}
            {fieldError('windowEndLocal', 'round-end-error')}
            {fieldError('graceMinutes', 'round-grace-error')}
            <ol aria-label="Vista previa de ventanas" className="flex flex-wrap gap-1.5">
              {labels.map((label) => (
                <li key={label} className="t-stamp bg-muted px-2 py-1 tabular-nums">
                  {label}
                </li>
              ))}
            </ol>
          </div>
        </details>
        <div className="ml-auto flex gap-2 self-center">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              leave();
            }}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar ronda'}
          </Button>
        </div>
      </form>

      {(errorCount > 1 || Boolean(fieldErrors.form ?? fieldErrors.route ?? message)) && (
        <Alert
          variant="destructive"
          role="alert"
          aria-label="Errores del formulario"
          className="m-3 mb-0"
        >
          {message && <p>{message}</p>}
          {errorCount > 1 &&
            Object.values(fieldErrors)
              .flat()
              .map((error) => <p key={error}>{error}</p>)}
          {fieldErrors.form?.map((error) => (
            <p key={error}>{error}</p>
          ))}
          {errorCount === 1 && fieldErrors.route?.map((error) => <p key={error}>{error}</p>)}
        </Alert>
      )}
      {routeFailures && (
        <Alert
          role="alertdialog"
          aria-label="No se pudo calcular el recorrido"
          className="m-3 mb-0 space-y-3"
        >
          <p className="font-medium">
            Hubo un fallo al calcular el recorrido por calles. No se guardó nada.
          </p>
          {failureMessages(routeFailures, route.legs.length, route.closed).map((text) => (
            <p key={text}>{text}</p>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                void save();
              }}
            >
              Reintentar
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                void save(true);
              }}
            >
              Guardar con tramos rectos
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setRouteFailures(undefined);
              }}
            >
              Cerrar
            </Button>
          </div>
        </Alert>
      )}

      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Puntos de la ronda"
          className="flex w-[clamp(17rem,22vw,24rem)] shrink-0 flex-col border-r border-border"
        >
          <div className="grid gap-2 border-b border-border p-3">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="font-cond text-lg font-semibold tracking-wider uppercase">Orden</h4>
              <span className="text-sm text-muted-foreground tabular-nums">
                {selected.length} de {points.length}
              </span>
            </div>
            <Input
              aria-label="Buscar punto"
              placeholder="Buscar punto"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
              }}
            />
            {fieldError('checkpointIds', 'round-checkpoints-error')}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {selected.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">
                Sumá puntos desde la lista de abajo o con Encadenar puntos en el mapa.
              </p>
            )}
            <ol aria-label="Orden de puntos">
              {selected.map((id, index) => {
                if (!matches(id)) return null;
                const leg = route.legs[index];
                const label = nameOf(id);
                const isFocus = focusId === id || active?.l === index;
                return (
                  <li
                    key={id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', id);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      moveTo(event.dataTransfer.getData('text/plain'), index);
                    }}
                    className={cn(
                      'group flex min-h-11 items-center gap-1.5 border-b border-border pr-1 pl-2',
                      isFocus && 'bg-muted',
                    )}
                  >
                    <GripVertical
                      aria-hidden="true"
                      className="size-4 shrink-0 cursor-grab text-muted-foreground"
                    />
                    <span className="t-numeral w-7 shrink-0 text-right">{index + 1}</span>
                    <button
                      type="button"
                      className="min-w-0 flex-1 py-1 text-left"
                      onClick={() => {
                        setFocusId(id);
                        if (leg) setPicked({ l: index, s: 0 });
                      }}
                    >
                      <span className="block truncate font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {leg
                          ? `→ ${formatMeters(meters[index] ?? 0)}${leg.waypoints.length ? ` · ${String(leg.waypoints.length)} ${leg.waypoints.length === 1 ? 'paso' : 'pasos'}` : ''}`
                          : 'Fin del recorrido'}
                        {failed.has(index) && ' · ✕ sin calcular'}
                        {stale.has(index) && ' · se movió un punto'}
                        {sharedIds.has(id) && ' · compartido'}
                      </span>
                    </button>
                    <span className="flex opacity-60 group-focus-within:opacity-100 group-hover:opacity-100">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Subir ${label}`}
                        disabled={index === 0}
                        onClick={() => {
                          moveTo(id, index - 1);
                        }}
                      >
                        <ChevronUp aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Bajar ${label}`}
                        disabled={index === selected.length - 1}
                        onClick={() => {
                          moveTo(id, index + 1);
                        }}
                      >
                        <ChevronDown aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Quitar ${label}`}
                        onClick={() => {
                          removePoint(id);
                        }}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ol>
            {outside.length > 0 && (
              <>
                <h4 className="t-label px-3 pt-4 pb-1">Fuera de la ronda</h4>
                <ul aria-label="Puntos fuera de la ronda">
                  {outside.map((point) => (
                    <li
                      key={point.id}
                      className="flex min-h-10 items-center gap-2 border-b border-border pr-1 pl-3"
                    >
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {point.name}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Sumar ${point.name}`}
                        onClick={() => {
                          addPoint(point.id);
                        }}
                      >
                        <Plus aria-hidden="true" />
                        Sumar
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2">
            <SegmentedFilter
              ariaLabel="Herramienta del mapa"
              options={TOOLS}
              value={tool}
              onChange={setTool}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={route.closed}
                onChange={(event) => {
                  commit(
                    selected,
                    reconcileRoute({ ids: selected, route }, selected, event.target.checked),
                  );
                }}
              />
              Volver al inicio
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={past.length === 0}
              title="Ctrl+Z"
              onClick={undo}
            >
              Deshacer
            </Button>
            <span className="ml-auto t-stamp tabular-nums">
              {route.legs.length ? formatMeters(total) : ''}
              {route.legs.length > 0 && !calculated && ' · borrador'}
            </span>
            <Button
              type="button"
              variant={calculated ? 'outline' : 'default'}
              size="sm"
              disabled={calculate.isPending || route.legs.length === 0}
              onClick={() => {
                calculate.mutate();
              }}
            >
              {calculate.isPending ? 'Calculando…' : 'Calcular por calles'}
            </Button>
          </div>

          <div className="relative min-h-0 flex-1">
            {allLocated ? (
              <RouteEditor
                points={located}
                selected={selected}
                route={route}
                display={display}
                active={active}
                focusId={focusId}
                tool={tool}
                onPointClick={(id) => {
                  if (tool === 'chain') {
                    if (!selected.includes(id)) addPoint(id);
                    else if (selected.at(-1) === id) removePoint(id);
                    else setFocusId(id);
                    return;
                  }
                  setFocusId(id);
                  const k = selected.indexOf(id);
                  if (k >= 0 && route.legs.length)
                    setPicked({ l: Math.min(k, route.legs.length - 1), s: 0 });
                }}
                onLineClick={(section, at) => {
                  if (tool === 'waypoint') insertWaypoint(section, at);
                  else if (tool === 'bend') addVia(section, at);
                  else setPicked(section);
                }}
                onMapClick={(at) => {
                  if (active && tool === 'waypoint') insertWaypoint(active, at);
                  else if (active && tool === 'bend') addVia(active, at);
                  else setFocusId(null);
                }}
                onRouteChange={editRoute}
              />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">
                Algunos puntos no tienen ubicación: el recorrido se armará por calles.
              </p>
            )}
          </div>

          <div className="grid gap-2 border-t border-border px-3 py-2 text-sm">
            {active && activeLeg && activeSection ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <NativeSelect
                  aria-label="Tramo elegido"
                  size="sm"
                  value={`${String(active.l)}-${String(active.s)}`}
                  onChange={(event) => {
                    const [l, s] = event.target.value.split('-').map(Number);
                    if (l !== undefined && s !== undefined) setPicked({ l, s });
                  }}
                >
                  {sectionOptions(route).map((option) => (
                    <NativeSelectOption
                      key={`${String(option.l)}-${String(option.s)}`}
                      value={`${String(option.l)}-${String(option.s)}`}
                    >
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <SegmentedFilter
                  ariaLabel={`Modo del ${(activeOption?.label ?? '').replace('Tramo', 'tramo')}`}
                  options={MODES}
                  value={activeSection.mode}
                  onChange={(mode) => {
                    editRoute(routeEdits.setMode(route, active.l, active.s, mode));
                  }}
                />
                <span className="text-muted-foreground tabular-nums">
                  {nameOf(selected[active.l] ?? '')} →{' '}
                  {nameOf(
                    selected[
                      route.closed && active.l === route.legs.length - 1 ? 0 : active.l + 1
                    ] ?? '',
                  )}{' '}
                  · {formatMeters(meters[active.l] ?? 0)}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={activeLeg.waypoints.length >= ROUTE_LIMITS.waypointsPerLeg}
                  onClick={() => {
                    const last = activeLeg.sections.length - 1;
                    atMidpoint({ l: active.l, s: last }, (at) => {
                      editRoute(routeEdits.addWaypoint(route, active.l, at));
                      setPicked({ l: active.l, s: last + 1 });
                    });
                  }}
                >
                  Agregar punto de paso al tramo{' '}
                  {legLabel(active.l, route.legs.length, route.closed)}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={activeSection.via.length >= ROUTE_LIMITS.viaPerSection}
                  onClick={() => {
                    atMidpoint(active, (at) => {
                      addVia(active, at);
                    });
                  }}
                >
                  Agregar {activeSection.mode === 'manual' ? 'quiebre' : 'punto intermedio'}
                </Button>
                {activeLeg.waypoints.length > 0 && (
                  <ol
                    aria-label={`Puntos de paso del tramo ${legLabel(active.l, route.legs.length, route.closed)}`}
                    className="flex flex-wrap gap-1.5"
                  >
                    {activeLeg.waypoints.map((_, k) => (
                      <li key={`wp-${String(k)}`} className="flex items-center gap-1 bg-muted pl-2">
                        Punto de paso {k + 1}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Quitar punto de paso ${String(k + 1)}`}
                          onClick={() => {
                            editRoute(routeEdits.removeWaypoint(route, active.l, k));
                          }}
                        >
                          <X aria-hidden="true" />
                        </Button>
                      </li>
                    ))}
                  </ol>
                )}
                {activeSection.via.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      editRoute(routeEdits.clearVia(route, active.l, active.s));
                    }}
                  >
                    Borrar {activeSection.via.length}{' '}
                    {activeSection.mode === 'manual' ? 'quiebres' : 'intermedios'}
                  </Button>
                )}
                {stale.has(active.l) && (
                  <span className="text-warning">
                    El punto se movió desde que se trazó este tramo: calculá de nuevo.
                  </span>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">
                Elegí dos o más puntos para armar el recorrido.
              </p>
            )}
            {previewMessages.length > 0 && (
              <div
                role="alert"
                aria-label="Fallas del recorrido"
                className="grid gap-1 text-danger"
              >
                {previewMessages.map((text) => (
                  <p key={text}>{text}</p>
                ))}
              </div>
            )}
            {calculate.isError && (
              <p role="alert" className="text-danger">
                No se pudo calcular el recorrido. Tu recorrido no se modificó: reintentá.
              </p>
            )}
            <p role="status" className="text-muted-foreground">
              {notice ||
                (calculated && previewMessages.length === 0
                  ? 'Recorrido calculado por calles.'
                  : `${HINTS[tool]} Atajos: V, E, P, Q y Ctrl+Z.`)}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
