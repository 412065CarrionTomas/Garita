import { useMutation } from '@tanstack/react-query';
import {
  ROUTE_LIMITS,
  defaultRouteInput,
  roundInputSchema,
  roundRoutePreviewInputSchema,
  roundRoutePreviewResponseSchema,
  routeFailuresErrorSchema,
  staleLegs,
  type LngLat,
  type RoundRoutePreviewInput,
  type RouteFailure,
  type RouteInput,
  type RouteMode,
  type SpeedProfile,
} from '@garita/shared';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { z } from 'zod';
import { FloatingNotice } from '@/components/floating-notice';
import { SegmentedFilter } from '@/components/segmented-filter';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, apiPatch, apiPost } from '@/lib/api-client';
import { useBusy } from '@/lib/use-busy';
import { useFloatingNotice } from '@/lib/use-floating-notice';
import { EditorHelp } from './editor-help';
import { LegsList } from './legs-list';
import { OrderList } from './order-list';
import { RouteEditor, type RouteSelection, type RouteTool } from './route-editor';
import {
  GUIDE_STEP_METERS,
  canJoinAt,
  failureMessages,
  formatMeters,
  legMeters,
  partKey,
  pointAfterLast,
  rebaseRoute,
  reconcileRoute,
  rememberFailures,
  rememberRoute,
  requestEstimate,
  resolveRoute,
  routeEdits,
  sectionMeters,
  storedRoute,
  storedRouteInput,
  viaInsertIndex,
  type RouteDraft,
  type SectionMemo,
} from './route-draft';
import { RouteInspector } from './route-inspector';
import { SchedulePicker } from './schedule-picker';
import { SpeedField } from './speed-field';

export interface EditorPoint {
  id: string;
  name: string;
  latitude?: number;
  longitude?: number;
}

export interface EditorRound {
  id: string;
  name: string;
  /** Turnos programados que toman la versión vigente: los alcanza la edición. */
  scheduledShifts?: number;
  currentVersion: {
    frequencyMinutes: number;
    windowStartLocal: string;
    windowEndLocal: string;
    graceMinutes: number;
    route?: unknown;
    /** Sin perfil: la ronda usa la velocidad del predio. */
    speedProfile?: SpeedProfile | null;
    maxSpeedKmh?: number | null;
    checkpoints: { checkpoint: { id: string; name: string } }[];
  } | null;
}

/** Campos que muestran su error al lado: el resto va al aviso de arriba. */
const INLINE_FIELDS = new Set([
  'name',
  'checkpointIds',
  'frequencyMinutes',
  'windowStartLocal',
  'windowEndLocal',
  'graceMinutes',
  'maxSpeedKmh',
]);

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

interface Snapshot {
  selected: string[];
  draft: RouteDraft;
}

/** Edición de una ronda: horario arriba, orden de puntos a la izquierda y el recorrido en el mapa. */
export function RoundEditor({
  siteId,
  points,
  round,
  copy = false,
  sharedIds,
  onClose,
}: {
  siteId: string;
  points: EditorPoint[];
  round?: EditorRound;
  /** Duplicar: arranca con los datos de `round` pero guarda una ronda nueva. */
  copy?: boolean;
  /** Puntos que ya están en otra ronda del predio. */
  sharedIds: Set<string>;
  /** Vuelve a la lista; con `message` si se guardó. */
  onClose: (message?: string) => void;
}) {
  const version = round?.currentVersion;
  // La ronda que se modifica: al duplicar no hay ninguna, se crea otra.
  const editing = copy ? undefined : round;
  const initialName = round ? (copy ? `Copia de ${round.name}`.slice(0, 100) : round.name) : '';
  const versionIds = version?.checkpoints.map(({ checkpoint }) => checkpoint.id) ?? [];
  // Al duplicar se omiten los puntos dados de baja después: `points` solo trae los activos y la
  // API rechaza una ronda nueva con un punto inactivo.
  const omitted = copy
    ? (version?.checkpoints ?? []).filter(({ checkpoint }) =>
        points.every((p) => p.id !== checkpoint.id),
      )
    : [];
  const initialIds = omitted.length
    ? versionIds.filter((id) => points.some((p) => p.id === id))
    : versionIds;
  const [name, setName] = useState(initialName);
  const [frequency, setFrequency] = useState(version?.frequencyMinutes ?? 120);
  const [start, setStart] = useState(version?.windowStartLocal ?? '22:00');
  const [end, setEnd] = useState(version?.windowEndLocal ?? '06:00');
  const [grace, setGrace] = useState(version?.graceMinutes ?? 15);
  const [speed, setSpeed] = useState<SpeedProfile | ''>(version?.speedProfile ?? '');
  // El perfil al momento de responder «Calcular por calles»: una respuesta de otro se descarta.
  const speedRef = useRef(speed);
  const [customKmh, setCustomKmh] = useState(String(version?.maxSpeedKmh ?? 10));
  const [selected, setSelected] = useState(initialIds);
  const [draft, setDraft] = useState<RouteDraft>(() => {
    const saved = storedRouteInput(version?.route) ?? defaultRouteInput(versionIds.length);
    // Sin los omitidos, el recorrido conserva solo los tramos que no los tocaban.
    return {
      ids: initialIds,
      route: omitted.length ? reconcileRoute({ ids: versionIds, route: saved }, initialIds) : saved,
    };
  });
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
    if (!saved || omitted.length) return new Map();
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState('');
  const {
    notice,
    notify,
    close: closeNotice,
  } = useFloatingNotice(
    omitted.length
      ? {
          text: `No se copiaron puntos dados de baja: ${omitted.map(({ checkpoint }) => checkpoint.name).join(', ')}.`,
        }
      : undefined,
  );
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
  // Contra los puntos de la versión: si al duplicar se omitió alguno, lo guardado ya no aplica.
  const savedRoute = versionIds.join() === selected.join() ? storedRoute(version?.route) : null;
  // Un tramo con un punto movido deja de avisar cuando sus partes por calles se recalcularon.
  const stale = new Set(
    (savedRoute && allLocated ? staleLegs(savedRoute, coords) : []).filter((l) =>
      parts.some((p) => p.l === l && p.mode === 'streets' && p.state !== 'calculated'),
    ),
  );
  const partMeters = sectionMeters(display);
  const meters = legMeters(display);
  const total = meters.reduce((sum, m) => sum + m, 0);

  const calculate = useMutation({
    mutationFn: (sent: RoundRoutePreviewInput) =>
      apiPost(
        '/rondas/ruteo-previsualizar',
        sent,
        roundRoutePreviewInputSchema,
        roundRoutePreviewResponseSchema,
      ),
    // Las fallas se leen contra el recorrido enviado: mientras tanto se pudo seguir editando.
    onSuccess: (result, sent) => {
      if ((sent.speedProfile ?? '') !== speedRef.current) return;
      setMemo((current) => rememberRoute(current, result.route, result.failures));
      const streets = result.route.legs.flatMap((leg) =>
        leg.sections.filter((section) => section.mode === 'streets'),
      ).length;
      const failed = new Set(result.failures.map((f) => `${String(f.leg)}-${String(f.section)}`))
        .size;
      if (failed)
        notify(
          `Se calcularon ${String(streets - failed)} de ${String(streets)} partes por calles. ${String(failed)} no se pudieron calcular: ${failureMessages(result.failures, sent.route).join(' ')}`,
          'danger',
        );
      else notify(`Se calcularon las ${String(streets)} partes por calles.`);
    },
    onError: (_error, sent) => {
      if ((sent.speedProfile ?? '') !== speedRef.current) return;
      notify('No se pudo calcular el recorrido. Tu recorrido no se modificó: reintentá.', 'danger');
    },
  });

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
    if (!ok) notify(`Una parte admite hasta ${String(ROUTE_LIMITS.viaPerSection)} puntos de guía.`);
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
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('input, select, textarea, [contenteditable="true"]')) return;
    // Con un diálogo abierto (como la ayuda), las teclas son del diálogo, no del editor.
    if (document.querySelector('[role="dialog"], [role="alertdialog"][aria-modal="true"]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      // Ctrl+Mayús+Z es rehacer: no hay rehacer, pero tampoco debe deshacer.
      if (event.shiftKey) return;
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
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      onKey(event);
    };
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
    };
  }, []);

  // Armar una ronda larga lleva tiempo: salir sin guardar pide confirmación si hubo cambios.
  const dirty =
    past.length > 0 ||
    name !== initialName ||
    frequency !== (version?.frequencyMinutes ?? 120) ||
    start !== (version?.windowStartLocal ?? '22:00') ||
    end !== (version?.windowEndLocal ?? '06:00') ||
    grace !== (version?.graceMinutes ?? 15) ||
    speed !== (version?.speedProfile ?? '') ||
    (speed === 'custom' && customKmh !== String(version?.maxSpeedKmh));
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
      speedProfile: speed || null,
      // Vacío: falta el dato (no «mínimo 5 km/h», que es lo que daría convertirlo a 0).
      ...(speed === 'custom' ? { maxSpeedKmh: customKmh.trim() || undefined } : {}),
      ...(allowStraight ? { allowStraight } : {}),
    });
    if (!parsed.success) {
      const errors = parsed.error.issues.reduce<Record<string, string[]>>((all, issue) => {
        const field = String(issue.path[0] ?? 'form');
        // El mensaje genérico de zod para una lista vacía no le dice nada a quien arma la ronda.
        const text =
          field === 'checkpointIds' && issue.code === 'too_small'
            ? 'Sumá al menos un punto a la ronda.'
            : issue.message;
        all[field] = [...(all[field] ?? []), text];
        return all;
      }, {});
      setFieldErrors(errors);
      // El error de los puntos se muestra en la pestaña Orden: si estaba en Tramos no se vería.
      if (errors.checkpointIds) setTab('order');
      setMessage('');
      return;
    }
    setFieldErrors({});
    setRouteFailures(undefined);
    try {
      if (editing) await apiPatch(`/rondas/${editing.id}`, parsed.data, roundInputSchema, idSchema);
      else await apiPost(`/predios/${siteId}/rondas`, parsed.data, roundInputSchema, idSchema);
      onClose(
        editing ? 'Ronda actualizada. Los cambios aplican a los turnos futuros.' : 'Ronda creada.',
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
    fieldErrors[field]?.map((error, i) => (
      <p
        className="text-sm text-danger"
        id={i === 0 ? id : undefined}
        key={`${String(i)}-${error}`}
      >
        {error}
      </p>
    ));
  const errorCount = Object.keys(fieldErrors).length;
  // Errores sin lugar junto a un campo: van al aviso de arriba aunque sean uno solo.
  const looseErrors = Object.entries(fieldErrors)
    .filter(([field]) => !INLINE_FIELDS.has(field))
    .flatMap(([, errors]) => errors);
  const matches = (id: string) =>
    !filter || nameOf(id).toLowerCase().includes(filter.toLowerCase());
  const outside = points.filter((p) => !selected.includes(p.id) && matches(p.id));

  return (
    <section
      ref={sectionRef}
      aria-labelledby="round-editor-title"
      className="flex h-[calc(100dvh-4.5rem)] min-h-[36rem] scroll-mt-2 flex-col overflow-hidden rounded-md border border-border bg-card"
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
          {editing ? 'Editar ronda' : copy ? 'Duplicar ronda' : 'Nueva ronda'}
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
        <SchedulePicker
          schedule={{ frequency, start, end, grace }}
          errors={fieldErrors}
          onChange={(next) => {
            setFrequency(next.frequency);
            setStart(next.start);
            setEnd(next.end);
            setGrace(next.grace);
          }}
        />
        <SpeedField
          speed={speed}
          kmh={customKmh}
          errors={fieldErrors.maxSpeedKmh}
          onSpeedChange={(next) => {
            setSpeed(next);
            speedRef.current = next;
            setFieldErrors(({ maxSpeedKmh: _dropped, ...rest }) => rest);
            // Lo calculado era para el perfil anterior: las partes por calles se recalculan.
            setMemo(new Map());
          }}
          onKmhChange={setCustomKmh}
        />
        <EditorHelp />
        {/* En la fila del formulario y no como franja: no le quita alto al mapa ni a la lista. */}
        {Boolean(editing?.scheduledShifts) && (
          <p
            role="note"
            aria-label="Turnos afectados"
            className="max-w-sm self-center text-sm text-muted-foreground"
          >
            {editing?.scheduledShifts === 1
              ? 'Los cambios se aplican al turno programado con esta ronda.'
              : `Los cambios se aplican a los ${String(editing?.scheduledShifts)} turnos programados con esta ronda.`}{' '}
            Los turnos en curso y el historial no cambian.
          </p>
        )}
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
            {busy ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </form>

      {(errorCount > 1 || looseErrors.length > 0 || Boolean(message)) && (
        <Alert
          variant="destructive"
          role="alert"
          aria-label="Errores del formulario"
          className="m-3 mb-0"
        >
          {message && <p>{message}</p>}
          {(errorCount > 1 ? Object.values(fieldErrors).flat() : looseErrors).map((error, i) => (
            <p key={`${String(i)}-${error}`}>{error}</p>
          ))}
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
              <OrderList
                selected={selected}
                outside={outside}
                visible={matches}
                nameOf={nameOf}
                route={route}
                meters={meters}
                parts={parts}
                stale={stale}
                sharedIds={sharedIds}
                focusId={current?.kind === 'point' ? current.id : null}
                onFocus={(id) => {
                  select({ kind: 'point', id });
                }}
                onMove={moveTo}
                onRemove={removePoint}
                onAdd={addPoint}
              />
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
                calculate.mutate({
                  siteId,
                  checkpointIds: selected,
                  route,
                  speedProfile: speed || null,
                });
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

          {(current !== null || route.legs.length === 0) && (
            <div className="grid gap-2 border-t border-border px-3 py-2 text-sm">
              <RouteInspector
                route={route}
                parts={parts}
                selection={current}
                meters={partMeters}
                stale={stale}
                pointName={nameOf}
                pointOrder={(id) => selected.indexOf(id)}
                onSetMode={(l, s, mode: RouteMode) => {
                  const next = routeEdits.setMode(route, l, s, mode);
                  editRoute(next);
                  // Si se unió con la parte anterior (mismo modo y entra en el tope), la elegida es esa.
                  const joinedBack =
                    s > 0 &&
                    route.legs[l]?.sections[s - 1]?.mode === mode &&
                    canJoinAt(route, l, s - 1, true);
                  select({ kind: 'part', l, s: joinedBack ? s - 1 : s });
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
            </div>
          )}
        </div>
      </div>
      {notice && (
        <FloatingNotice
          key={notice.id}
          text={notice.text}
          tone={notice.tone}
          onClose={closeNotice}
        />
      )}
    </section>
  );
}
