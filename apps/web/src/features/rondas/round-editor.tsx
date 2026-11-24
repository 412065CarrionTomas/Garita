import { useMutation } from '@tanstack/react-query';
import {
  ROUTE_LIMITS,
  defaultGraceMinutes,
  defaultRouteInput,
  previewWindows,
  roundInputSchema,
  roundRoutePreviewInputSchema,
  roundRoutePreviewResponseSchema,
  routeFailuresErrorSchema,
  staleLegs,
  type LngLat,
  type RouteFailure,
  type RouteInput,
  type RouteMode,
} from '@garita/shared';
import { ChevronDown, ChevronUp, CircleHelp, GripVertical, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { SegmentedFilter } from '@/components/segmented-filter';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, apiPatch, apiPost } from '@/lib/api-client';
import { useBusy } from '@/lib/use-busy';
import { cn } from '@/lib/utils';
import { LegsList } from './legs-list';
import { RouteEditor, type RouteSelection, type RouteTool } from './route-editor';
import {
  failureMessages,
  formatMeters,
  legMeters,
  GUIDE_STEP_METERS,
  partKey,
  pointAfterLast,
  rebaseRoute,
  reconcileRoute,
  rememberFailures,
  rememberRoute,
  requestEstimate,
  resolveRoute,
  routeEdits,
  storedRoute,
  storedRouteInput,
  viaInsertIndex,
  type RouteDraft,
  type SectionMemo,
} from './route-draft';
import { RouteInspector } from './route-inspector';

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
  { value: 'select', label: 'Seleccionar' },
  { value: 'chain', label: 'Sumar puntos de control' },
];
const SHORTCUTS: Record<string, RouteTool> = { v: 'select', e: 'chain' };
const TABS: { value: 'order' | 'legs'; label: string }[] = [
  { value: 'order', label: 'Orden' },
  { value: 'legs', label: 'Tramos' },
];
const idSchema = z.looseObject({ id: z.string() });

/** Qué hace cada control del editor que no se explica solo con su nombre. */
const HELP: { title: string; items: [string, string][] }[] = [
  {
    title: 'Horario',
    items: [
      ['Franja', 'Horas del día en que la ronda está vigente.'],
      ['Frecuencia', 'Cada cuántos minutos empieza una vuelta nueva dentro de la franja.'],
      [
        'Ventana',
        'Cada período de la frecuencia. En cada ventana hay que pasar por todos los puntos.',
      ],
      [
        'Gracia',
        'Minutos después del fin de una ventana en que un registro todavía cuenta para ella, marcado como tarde.',
      ],
    ],
  },
  {
    title: 'Orden',
    items: [
      ['Compartido', 'El punto también forma parte de otra ronda del predio.'],
      ['Fuera de la ronda', 'Puntos del predio que esta ronda no incluye.'],
    ],
  },
  {
    title: 'Recorrido',
    items: [
      ['Tramo', 'El camino de un punto de control al siguiente.'],
      ['Parte', 'Un pedazo del tramo con un solo modo: por calles o trazo libre.'],
      [
        'Punto de guía',
        'Da forma a la línea de su parte. Por calles, la ruta pasa por ahí; en trazo libre, la línea dobla ahí. No se escanea.',
      ],
      ['Cambio de modo', 'Punto donde termina una parte y empieza otra con el otro modo.'],
      ['Por calles', 'La línea sigue las calles; se calcula con «Calcular por calles».'],
      ['Trazo libre', 'Rectas entre sus puntos. No se calcula.'],
    ],
  },
  {
    title: 'Herramientas del mapa',
    items: [
      [
        'Seleccionar',
        'Tocá una línea para elegir su parte; sobre la parte elegida, un clic suma un punto de guía. Los puntos se arrastran y el clic derecho los elimina.',
      ],
      [
        'Sumar puntos de control',
        'Tocá los puntos del predio en el orden en que se recorren: se suman al final. Tocar el último lo saca.',
      ],
      ['Volver al inicio', 'Agrega un último tramo del último punto al primero.'],
      [
        'Calcular por calles',
        'Pide al servicio de rutas solo las partes por calles sin calcular. Hasta calcularlas se ven como línea de puntos recta.',
      ],
    ],
  },
];

function EditorHelp() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="self-center text-muted-foreground"
          aria-label="Ayuda del editor de rondas"
          title="Ayuda"
        >
          <CircleHelp aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogTitle className="text-lg font-semibold">Cómo se arma una ronda</DialogTitle>
        <DialogDescription className="sr-only">Qué hace cada control del editor.</DialogDescription>
        {HELP.map((group) => (
          <section key={group.title} className="mt-4">
            <h4 className="t-label">{group.title}</h4>
            <dl className="mt-1 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[11rem_1fr]">
              {group.items.map(([term, text]) => (
                <div key={term} className="contents">
                  <dt className="font-semibold">{term}</dt>
                  <dd className="text-muted-foreground">{text}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}

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
  const [tool, setTool] = useState<RouteTool>('select');
  const [selection, setSelection] = useState<RouteSelection | null>(null);
  const [tab, setTab] = useState<'order' | 'legs'>('order');
  // Partes con la lista de puntos de guía abierta: esos puntos muestran su número en el mapa.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  // Lo que ya se sabe de cada parte por calles: arranca con lo guardado.
  const [memo, setMemo] = useState<SectionMemo>(() => {
    const saved = storedRoute(version?.route);
    if (!saved) return new Map();
    const at = initialIds.flatMap((id) => {
      const point = points.find((p) => p.id === id);
      return point?.latitude !== undefined && point.longitude !== undefined
        ? [[point.longitude, point.latitude] as LngLat]
        : [];
    });
    return rememberRoute(
      new Map(),
      at.length === initialIds.length ? rebaseRoute(saved, at) : saved,
    );
  });
  const [filter, setFilter] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [summary, setSummary] = useState('');
  const [routeFailures, setRouteFailures] = useState<RouteFailure[]>();
  const { busy, run } = useBusy();
  const sectionRef = useRef<HTMLElement>(null);

  // El recorrido sigue a la lista de puntos: conserva los tramos que no cambiaron.
  const route = reconcileRoute(draft, selected);

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

  const { display, parts } = resolveRoute(route, coords, memo);
  const estimate = requestEstimate(parts);
  const savedRoute = initialIds.join() === selected.join() ? storedRoute(version?.route) : null;
  const stale = new Set(savedRoute && allLocated ? staleLegs(savedRoute, coords) : []);
  const meters = legMeters(display);
  const total = meters.reduce((sum, m) => sum + m, 0);
  const partsOfLeg = (l: number) => parts.filter((p) => p.l === l);

  const calculate = useMutation({
    mutationFn: () =>
      apiPost(
        '/rondas/ruteo-previsualizar',
        { siteId, checkpointIds: selected, route },
        roundRoutePreviewInputSchema,
        roundRoutePreviewResponseSchema,
      ),
    onSuccess: (result) => {
      setMemo((current) => rememberRoute(current, result.route, result.failures));
      const streets = result.route.legs.flatMap((leg) =>
        leg.sections.filter((section) => section.mode === 'streets'),
      ).length;
      const failed = new Set(result.failures.map((f) => `${String(f.leg)}-${String(f.section)}`))
        .size;
      setSummary(
        failed
          ? `Se calcularon ${String(streets - failed)} de ${String(streets)} partes por calles. ${String(failed)} no se pudieron calcular: ${failureMessages(result.failures, route).join(' ')}`
          : `Se calcularon las ${String(streets)} partes por calles.`,
      );
    },
  });

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

  // Lo elegido puede dejar de existir al editar o deshacer: entonces no hay nada elegido.
  const current = ((): RouteSelection | null => {
    if (!selection) return null;
    if (selection.kind === 'point')
      return points.some((p) => p.id === selection.id) ? selection : null;
    const leg = route.legs[selection.l];
    if (selection.kind === 'waypoint') return leg?.waypoints[selection.k] ? selection : null;
    const section = leg?.sections[selection.s];
    if (selection.kind === 'part') return section ? selection : null;
    return section?.via[selection.i] ? selection : null;
  })();
  // La pestaña sigue a lo elegido: un punto de control en Orden, lo del recorrido en Tramos.
  const select = (next: RouteSelection | null) => {
    setSelection(next);
    if (next) setTab(next.kind === 'point' ? 'order' : 'legs');
    // Lo elegido en el mapa tiene que verse en la lista: su tramo se despliega.
    if (next && next.kind !== 'point')
      setCollapsed((closed) => new Set([...closed].filter((l) => l !== next.l)));
  };

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
  };
  const removePoint = (id: string) => {
    setPoints(selected.filter((item) => item !== id));
  };
  const moveTo = (id: string, index: number) => {
    const rest = selected.filter((item) => item !== id);
    if (rest.length === selected.length || index < 0 || index > rest.length) return;
    setPoints([...rest.slice(0, index), id, ...rest.slice(index)]);
  };
  const viaRoom = (l: number, s: number) => {
    const ok = (route.legs[l]?.sections[s]?.via.length ?? 0) < ROUTE_LIMITS.viaPerSection;
    if (!ok)
      setNotice(`Una parte admite hasta ${String(ROUTE_LIMITS.viaPerSection)} puntos de guía.`);
    return ok;
  };
  /** Punto de guía tocado sobre la línea de la parte: va en su lugar a lo largo de la línea. */
  const addVia = (l: number, s: number, at: LngLat) => {
    const section = route.legs[l]?.sections[s];
    const line = display.legs[l]?.sections[s]?.geometry;
    if (!section || !line || !viaRoom(l, s)) return;
    const i = viaInsertIndex(section.via, line, at);
    editRoute(routeEdits.insertVia(route, l, s, i, at));
    select({ kind: 'via', l, s, i });
  };
  const controlOf = (l: number, s: number) =>
    parts.find((p) => p.l === l && p.s === s)?.control ?? [];
  /** «+» de la lista: un punto de guía a poca distancia del último, para sumar varios y moldearlos. */
  const addGuide = (l: number, s: number) => {
    const at = pointAfterLast(controlOf(l, s), GUIDE_STEP_METERS);
    const i = route.legs[l]?.sections[s]?.via.length ?? 0;
    if (!at || !viaRoom(l, s)) return;
    editRoute(routeEdits.insertVia(route, l, s, i, at));
    select({ kind: 'via', l, s, i });
  };
  /** «+<modo>» de la lista: desde la mitad del último tramo recto hasta el destino, el otro modo. */
  const addModeChange = (l: number, s: number) => {
    const at = pointAfterLast(controlOf(l, s));
    if (!at) return;
    editRoute(routeEdits.appendModeChange(route, l, s, at));
    select({ kind: 'part', l, s: s + 1 });
  };
  const removeGuide = (l: number, s: number, i: number) => {
    editRoute(routeEdits.removeVia(route, l, s, i));
    select({ kind: 'part', l, s });
  };
  const split = (l: number, s: number, i: number) => {
    editRoute(routeEdits.splitAtVia(route, l, s, i));
    select({ kind: 'waypoint', l, k: s });
  };
  const merge = (l: number, k: number) => {
    const i = route.legs[l]?.sections[k]?.via.length ?? 0;
    editRoute(routeEdits.mergeAtWaypoint(route, l, k));
    select({ kind: 'via', l, s: k, i });
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
      if (event.key === 'Escape') {
        setTool('select');
        setSelection(null);
        return;
      }
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
        const { failures } = routeError.data;
        setMemo((known) => rememberFailures(known, route, coords, failures));
        setRouteFailures(failures);
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
        {/* Sin título ni «volver» a la vista: se sale con Cancelar. */}
        <h3 id="round-editor-title" className="sr-only">
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
        <EditorHelp />
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
          {failureMessages(routeFailures, route).map((text) => (
            <p key={text}>{text}</p>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => {
                const first = routeFailures.find((f) => f.reason !== 'skipped') ?? routeFailures[0];
                if (first) select({ kind: 'part', l: first.leg, s: first.section });
                setRouteFailures(undefined);
              }}
            >
              Ver la parte con falla
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                void save(true);
              }}
            >
              Guardar con esas partes rectas
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
          aria-label="Puntos y tramos de la ronda"
          className="flex w-[clamp(17rem,22vw,24rem)] shrink-0 flex-col border-r border-border"
        >
          <div className="grid gap-2 border-b border-border p-3">
            <SegmentedFilter
              ariaLabel="Columna"
              options={TABS}
              value={tab}
              onChange={setTab}
              className="[&>button]:flex-1"
            />
            {tab === 'order' ? (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <h4 className="font-cond text-lg font-semibold tracking-wider uppercase">
                    Orden
                  </h4>
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
              </>
            ) : (
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="font-cond text-lg font-semibold tracking-wider uppercase">Tramos</h4>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {route.legs.length} · {formatMeters(total)}
                </span>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'legs' ? (
              <LegsList
                route={route}
                parts={parts}
                meters={meters}
                selection={current}
                onSelect={select}
                onAddGuide={addGuide}
                onAddModeChange={addModeChange}
                expanded={expanded}
                collapsed={collapsed}
                onToggleLeg={(l) => {
                  setCollapsed((closed) => {
                    const next = new Set(closed);
                    if (!next.delete(l)) next.add(l);
                    return next;
                  });
                }}
                onToggle={(l, s) => {
                  const key = partKey(l, s);
                  setExpanded((open) => {
                    const next = new Set(open);
                    if (!next.delete(key)) next.add(key);
                    return next;
                  });
                }}
                onRemoveGuide={removeGuide}
              />
            ) : (
              <>
                {selected.length === 0 && (
                  <p className="p-3 text-sm text-muted-foreground">
                    Sumá puntos desde la lista de abajo o con «Sumar puntos de control» en el mapa.
                  </p>
                )}
                <ol aria-label="Orden de puntos">
                  {selected.map((id, index) => {
                    if (!matches(id)) return null;
                    const leg = route.legs[index];
                    const label = nameOf(id);
                    const legParts = partsOfLeg(index);
                    const isFocus = current?.kind === 'point' && current.id === id;
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
                            select({ kind: 'point', id });
                          }}
                        >
                          <span className="block truncate font-medium">{label}</span>
                          <span className="block text-xs text-muted-foreground tabular-nums">
                            {leg
                              ? `→ ${formatMeters(meters[index] ?? 0)}${leg.sections.length > 1 ? ` · ${String(leg.sections.length)} partes` : ''}`
                              : 'Fin del recorrido'}
                            {legParts.some((p) => p.state === 'failed') && ' · ✕ falló'}
                            {legParts.some((p) => p.state === 'pending') && ' · sin calcular'}
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
                role="switch"
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
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {estimate.pending
                ? `${String(estimate.pending)} ${estimate.pending === 1 ? 'parte' : 'partes'} sin calcular · hasta ${String(estimate.requests)} ${estimate.requests === 1 ? 'pedido' : 'pedidos'}`
                : 'No hay partes por calles sin calcular'}
            </span>
            <Button
              type="button"
              size="sm"
              disabled={calculate.isPending || estimate.pending === 0}
              onClick={() => {
                setSummary('');
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
                selection={current}
                tool={tool}
                onSelect={select}
                onPointClick={(id) => {
                  if (tool === 'chain') {
                    if (!selected.includes(id)) addPoint(id);
                    else if (selected.at(-1) === id) removePoint(id);
                    else select({ kind: 'point', id });
                    return;
                  }
                  select({ kind: 'point', id });
                }}
                onAddVia={addVia}
                numbered={expanded}
                onRouteChange={editRoute}
              />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">
                Algunos puntos no tienen ubicación: el recorrido se armará por calles.
              </p>
            )}
          </div>

          <div className="grid gap-2 border-t border-border px-3 py-2 text-sm">
            <RouteInspector
              route={route}
              parts={parts}
              selection={current}
              meters={meters}
              stale={stale}
              pointName={nameOf}
              pointOrder={(id) => selected.indexOf(id)}
              onSetMode={(l, s, mode: RouteMode) => {
                editRoute(routeEdits.setMode(route, l, s, mode));
              }}
              onSplit={split}
              onMerge={merge}
              onRemoveVia={removeGuide}
              onRemoveWaypoint={(l, k) => {
                editRoute(routeEdits.removeWaypoint(route, l, k));
                select({ kind: 'part', l, s: k });
              }}
              onRemovePoint={(id) => {
                removePoint(id);
                setSelection(null);
              }}
            />
            {calculate.isError && (
              <p role="alert" className="text-danger">
                No se pudo calcular el recorrido. Tu recorrido no se modificó: reintentá.
              </p>
            )}
            <p role="status" aria-live="polite" className="text-muted-foreground empty:hidden">
              {notice || summary}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
