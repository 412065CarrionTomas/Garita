import { useQuery } from '@tanstack/react-query';
import {
  defaultGraceMinutes,
  defaultRouteInput,
  previewWindows,
  roundInputSchema,
  roundRouteSchema,
  routeFailuresErrorSchema,
  type RouteFailure,
} from '@garita/shared';
import { useState } from 'react';
import { z } from 'zod';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { useBusy } from '@/lib/use-busy';
import { useAuth } from '../auth/auth-context';

import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RouteEditor } from './route-editor';
import {
  failureMessages,
  legLabel,
  reconcileRoute,
  storedRouteInput,
  type RouteDraft,
} from './route-draft';

const checkpointsSchema = z.array(
  z.looseObject({
    id: z.string(),
    name: z.string(),
    latitude: z.coerce.number().optional(),
    longitude: z.coerce.number().optional(),
  }),
);
const roundsSchema = z.array(
  z.looseObject({
    id: z.string(),
    name: z.string(),
    status: z.enum(['active', 'inactive']),
    currentVersion: z
      .looseObject({
        frequencyMinutes: z.number(),
        windowStartLocal: z.string(),
        windowEndLocal: z.string(),
        graceMinutes: z.number(),
        route: z.unknown().optional(),
        checkpoints: z.array(
          z.looseObject({
            position: z.number(),
            checkpoint: z.looseObject({ id: z.string(), name: z.string() }),
          }),
        ),
      })
      .nullable(),
  }),
);
const idSchema = z.looseObject({ id: z.string() });

export function RoundsPanel({ site }: { site: { id: string; status: 'active' | 'inactive' } }) {
  const { user } = useAuth();
  const canWrite = user?.role === 'admin' || user?.role === 'supervisor';
  const rounds = useQuery({
    queryKey: ['rondas', site.id],
    queryFn: () => apiGet(`/predios/${site.id}/rondas`, roundsSchema),
  });
  const points = useQuery({
    queryKey: ['puntos', site.id],
    queryFn: () => apiGet(`/predios/${site.id}/puntos`, checkpointsSchema),
  });
  const [name, setName] = useState('');
  const { busy, run } = useBusy();
  const [frequency, setFrequency] = useState(120);
  const [start, setStart] = useState('22:00');
  const [end, setEnd] = useState('06:00');
  const [grace, setGrace] = useState(15);
  const [selected, setSelected] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string>();
  const [confirmId, setConfirmId] = useState<string>();
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [routeDraft, setRouteDraft] = useState<RouteDraft>({
    ids: [],
    route: defaultRouteInput(0),
  });
  // El recorrido sigue a la lista de puntos: conserva los tramos que no cambiaron.
  const route = reconcileRoute(routeDraft, selected);
  const [routeFailures, setRouteFailures] = useState<RouteFailure[]>();
  const editing = rounds.data?.find((round) => round.id === editingId);
  const savedIds = editing?.currentVersion?.checkpoints.map(({ checkpoint }) => checkpoint.id);
  const savedRoute =
    savedIds?.join() === selected.join()
      ? roundRouteSchema.safeParse(editing?.currentVersion?.route).data
      : undefined;
  const routePoints = selected.flatMap((id) => {
    const point = points.data?.find((item) => item.id === id);
    return point?.latitude !== undefined && point.longitude !== undefined
      ? [{ id, name: point.name, lat: point.latitude, lng: point.longitude }]
      : [];
  });
  const labels = previewWindows({
    windowStartLocal: start,
    windowEndLocal: end,
    frequencyMinutes: frequency,
  });
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
      const nextErrors = parsed.error.issues.reduce<Record<string, string[]>>((errors, issue) => {
        const field = String(issue.path[0] ?? 'form');
        errors[field] = [...(errors[field] ?? []), issue.message];
        return errors;
      }, {});
      setFieldErrors(nextErrors);
      setMessage('');
      return;
    }
    setFieldErrors({});
    setRouteFailures(undefined);
    try {
      if (editingId)
        await apiPatch(`/rondas/${editingId}`, parsed.data, roundInputSchema, idSchema);
      else await apiPost(`/predios/${site.id}/rondas`, parsed.data, roundInputSchema, idSchema);
      setMessage(
        editingId
          ? 'Ronda actualizada. Los cambios aplican a los turnos futuros.'
          : 'Ronda creada.',
      );
      setEditingId(undefined);
      await rounds.refetch();
    } catch (error) {
      // El ruteo falló: no se guardó nada y el formulario queda como estaba para reintentar.
      const failed =
        error instanceof ApiError && error.status === 422
          ? routeFailuresErrorSchema.safeParse(error.body)
          : undefined;
      if (failed?.success) {
        setRouteFailures(failed.data.failures);
        setMessage('');
        return;
      }
      setMessage('No se pudo guardar la ronda. Verificá los puntos y el nombre.');
    }
  };
  return (
    <section className="mt-4" aria-labelledby={`rounds-${site.id}`}>
      <Card className="border-0 py-0">
        <CardHeader>
          <h3
            id={`rounds-${site.id}`}
            className="font-cond text-xl font-semibold uppercase tracking-wider"
          >
            Rondas
          </h3>
        </CardHeader>
        <CardContent className="space-y-6">
          {rounds.isPending ? (
            <p role="status">Cargando rondas…</p>
          ) : (
            rounds.data?.map((round) => (
              <article key={round.id} className="space-y-3 border-b border-border pb-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-medium">{round.name}</h4>
                  <StatusBadge tone={round.status === 'active' ? 'success' : 'neutral'}>
                    {round.status === 'active' ? 'Activo' : 'Inactivo'}
                  </StatusBadge>
                </div>
                <p className="tabular-nums text-muted-foreground">
                  {round.currentVersion?.windowStartLocal}–{round.currentVersion?.windowEndLocal} ·
                  cada {round.currentVersion?.frequencyMinutes} min
                </p>
                <ol>
                  {round.currentVersion?.checkpoints.map(({ checkpoint }) => (
                    <li key={checkpoint.id}>{checkpoint.name}</li>
                  ))}
                </ol>
                {round.status === 'active' && canWrite && (
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingId(round.id);
                        setName(round.name);
                        setFrequency(round.currentVersion?.frequencyMinutes ?? 120);
                        setStart(round.currentVersion?.windowStartLocal ?? '22:00');
                        setEnd(round.currentVersion?.windowEndLocal ?? '06:00');
                        setGrace(round.currentVersion?.graceMinutes ?? 15);
                        const ids =
                          round.currentVersion?.checkpoints.map(
                            ({ checkpoint }) => checkpoint.id,
                          ) ?? [];
                        setSelected(ids);
                        setRouteDraft({
                          ids,
                          route:
                            storedRouteInput(round.currentVersion?.route) ??
                            defaultRouteInput(ids.length),
                        });
                        setRouteFailures(undefined);
                      }}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="ghostDestructive"
                      size="sm"
                      onClick={() => {
                        setConfirmId(round.id);
                      }}
                    >
                      Dar de baja
                    </Button>
                  </div>
                )}
                {confirmId === round.id && (
                  <Alert
                    role="alertdialog"
                    aria-label="Confirmar baja"
                    className="space-y-3 border-warning bg-warning-soft text-warning"
                  >
                    <p>¿Dar de baja {round.name}?</p>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        void apiPost(`/rondas/${round.id}/baja`, {}, z.object({}), idSchema).then(
                          () => rounds.refetch(),
                        );
                        setConfirmId(undefined);
                      }}
                    >
                      Confirmar baja
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setConfirmId(undefined);
                      }}
                    >
                      Cancelar
                    </Button>
                  </Alert>
                )}
              </article>
            ))
          )}
          {canWrite && site.status === 'active' && (
            <form
              className="grid gap-3"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <h4 className="font-cond text-xl font-semibold uppercase tracking-wider">
                {editingId ? 'Editar ronda' : 'Nueva ronda'}
              </h4>
              <Label className="grid min-w-0 gap-2" htmlFor="round-name">
                Nombre
                <Input
                  id="round-name"
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={fieldErrors.name ? 'round-name-error' : undefined}
                  className="w-full"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  required
                />
              </Label>
              {fieldErrors.name?.map((error) => (
                <p className="text-sm text-danger" id="round-name-error" key={error}>
                  {error}
                </p>
              ))}
              <Label className="grid min-w-0 gap-2" htmlFor="round-frequency">
                Frecuencia (minutos)
                <Input
                  id="round-frequency"
                  aria-invalid={Boolean(fieldErrors.frequencyMinutes)}
                  aria-describedby={
                    fieldErrors.frequencyMinutes ? 'round-frequency-error' : undefined
                  }
                  className="w-full"
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
              </Label>
              {fieldErrors.frequencyMinutes?.map((error) => (
                <p className="text-sm text-danger" id="round-frequency-error" key={error}>
                  {error}
                </p>
              ))}
              <Label className="grid min-w-0 gap-2" htmlFor="round-start">
                Inicio de franja
                <Input
                  id="round-start"
                  aria-invalid={Boolean(fieldErrors.windowStartLocal)}
                  aria-describedby={fieldErrors.windowStartLocal ? 'round-start-error' : undefined}
                  className="w-full"
                  type="time"
                  value={start}
                  onChange={(event) => {
                    setStart(event.target.value);
                  }}
                />
              </Label>
              {fieldErrors.windowStartLocal?.map((error) => (
                <p className="text-sm text-danger" id="round-start-error" key={error}>
                  {error}
                </p>
              ))}
              <Label className="grid min-w-0 gap-2" htmlFor="round-end">
                Fin de franja
                <Input
                  id="round-end"
                  aria-invalid={Boolean(fieldErrors.windowEndLocal)}
                  aria-describedby={fieldErrors.windowEndLocal ? 'round-end-error' : undefined}
                  className="w-full"
                  type="time"
                  value={end}
                  onChange={(event) => {
                    setEnd(event.target.value);
                  }}
                />
              </Label>
              {fieldErrors.windowEndLocal?.map((error) => (
                <p className="text-sm text-danger" id="round-end-error" key={error}>
                  {error}
                </p>
              ))}
              {start === end && <p>Todo el día (24 h)</p>}
              <Label className="grid min-w-0 gap-2" htmlFor="round-grace">
                Gracia (minutos; predeterminada {defaultGraceMinutes(frequency)}, máximo{' '}
                {Math.min(60, frequency / 2)})
                <Input
                  id="round-grace"
                  aria-invalid={Boolean(fieldErrors.graceMinutes)}
                  aria-describedby={fieldErrors.graceMinutes ? 'round-grace-error' : undefined}
                  className="w-full"
                  type="number"
                  min="0"
                  max="60"
                  value={grace}
                  onChange={(event) => {
                    setGrace(Number(event.target.value));
                  }}
                />
              </Label>
              {fieldErrors.graceMinutes?.map((error) => (
                <p className="text-sm text-danger" id="round-grace-error" key={error}>
                  {error}
                </p>
              ))}
              <fieldset className="space-y-3">
                <legend className="mb-3 font-medium">Puntos en orden de recorrido</legend>
                {fieldErrors.checkpointIds?.map((error) => (
                  <p className="text-sm text-danger" id="round-checkpoints-error" key={error}>
                    {error}
                  </p>
                ))}
                {points.data?.map((point) => (
                  <Label key={point.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(point.id)}
                      onChange={(event) => {
                        setSelected(
                          event.target.checked
                            ? [...selected, point.id]
                            : selected.filter((id) => id !== point.id),
                        );
                      }}
                    />{' '}
                    {point.name}
                  </Label>
                ))}
              </fieldset>
              <ol
                aria-label="Orden de puntos"
                onDragOver={(event) => {
                  event.preventDefault();
                }}
              >
                {selected.map((pointId, index) => {
                  const point = points.data?.find(({ id }) => id === pointId);
                  const shared = rounds.data?.some(
                    (round) =>
                      round.id !== editingId &&
                      round.currentVersion?.checkpoints.some(
                        ({ checkpoint }) => checkpoint.id === pointId,
                      ),
                  );
                  return (
                    <li
                      key={pointId}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/plain', pointId);
                      }}
                      onDrop={(event) => {
                        const source = event.dataTransfer.getData('text/plain');
                        setSelected((items) => {
                          const reordered = [...items];
                          const from = reordered.indexOf(source);
                          if (from >= 0) {
                            reordered.splice(from, 1);
                            reordered.splice(index, 0, source);
                          }
                          return reordered;
                        });
                      }}
                      className="flex flex-wrap items-center gap-2"
                    >
                      {point?.name}
                      {shared && (
                        <span>Compartido con otra ronda (un registro cuenta para ambas).</span>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        aria-label={`Subir ${point?.name}`}
                        disabled={index === 0}
                        onClick={() => {
                          setSelected((items) => {
                            const copy = [...items];
                            const current = copy[index];
                            const previous = copy[index - 1];
                            if (current !== undefined && previous !== undefined) {
                              copy[index - 1] = current;
                              copy[index] = previous;
                            }
                            return copy;
                          });
                        }}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        aria-label={`Bajar ${point?.name}`}
                        disabled={index === selected.length - 1}
                        onClick={() => {
                          setSelected((items) => {
                            const copy = [...items];
                            const current = copy[index];
                            const next = copy[index + 1];
                            if (current !== undefined && next !== undefined) {
                              copy[index] = next;
                              copy[index + 1] = current;
                            }
                            return copy;
                          });
                        }}
                      >
                        ↓
                      </Button>
                    </li>
                  );
                })}
              </ol>
              {selected.length >= 2 &&
                (routePoints.length === selected.length ? (
                  <RouteEditor
                    siteId={site.id}
                    points={routePoints}
                    route={route}
                    savedRoute={savedRoute}
                    onChange={(next) => {
                      setRouteDraft({ ids: selected, route: next });
                    }}
                    onClosedChange={(closed) => {
                      setRouteDraft({
                        ids: selected,
                        route: reconcileRoute(routeDraft, selected, closed),
                      });
                    }}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Algunos puntos no tienen ubicación: el recorrido se armará por calles.
                  </p>
                ))}
              <div>
                <h5 className="mb-2 font-medium">Vista previa de ventanas</h5>
                <ol
                  className="grid gap-2 tabular-nums text-muted-foreground sm:grid-cols-2"
                  aria-label="Vista previa de ventanas"
                >
                  {labels.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ol>
              </div>
              {(Object.keys(fieldErrors).length > 1 ||
                Boolean(fieldErrors.form ?? fieldErrors.route ?? message)) && (
                <Alert variant="destructive" role="alert" aria-label="Errores del formulario">
                  {message && <p>{message}</p>}
                  {Object.keys(fieldErrors).length > 1 &&
                    Object.values(fieldErrors)
                      .flat()
                      .map((error) => <p key={error}>{error}</p>)}
                  {fieldErrors.form?.map((error) => (
                    <p key={error}>{error}</p>
                  ))}
                  {Object.keys(fieldErrors).length === 1 &&
                    fieldErrors.route?.map((error) => <p key={error}>{error}</p>)}
                </Alert>
              )}
              {routeFailures && (
                <Alert
                  role="alertdialog"
                  aria-label="No se pudo calcular el recorrido"
                  className="space-y-3"
                >
                  <p className="font-medium">
                    Hubo un fallo al calcular el recorrido por calles. No se guardó nada.
                  </p>
                  {failureMessages(routeFailures, route.legs.length, route.closed).map((text) => (
                    <p key={text}>{text}</p>
                  ))}
                  <p>
                    Tramos sin calcular:{' '}
                    {[...new Set(routeFailures.map((failure) => failure.leg))]
                      .map((leg) => legLabel(leg, route.legs.length, route.closed))
                      .join(', ')}
                    .
                  </p>
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
              <Button type="submit" disabled={busy}>
                Guardar ronda
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
