import { useQuery } from '@tanstack/react-query';
import { defaultRouteInput, roundRouteSchema, type LngLat } from '@garita/shared';
import { useState } from 'react';
import { z } from 'zod';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiGet, apiPost } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';
import { cn } from '@/lib/utils';
import { useFillHeight } from '@/lib/use-fill-height';
import { RoundEditor } from './round-editor';
import { RouteEditor } from './route-editor';
import { resolveRoute, storedRoute, storedRouteInput } from './route-draft';

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

/** Rondas del predio: la lista y, al crear o editar una, el editor con el mapa. */
export function RoundsPanel({ site }: { site: { id: string; status: 'active' | 'inactive' } }) {
  const { user } = useAuth();
  const canWrite =
    (user?.role === 'admin' || user?.role === 'supervisor') && site.status === 'active';
  const rounds = useQuery({
    queryKey: ['rondas', site.id],
    queryFn: () => apiGet(`/predios/${site.id}/rondas`, roundsSchema),
  });
  const points = useQuery({
    queryKey: ['puntos', site.id],
    queryFn: () => apiGet(`/predios/${site.id}/puntos`, checkpointsSchema),
  });
  // undefined = lista; null = ronda nueva; string = ronda que se edita.
  const [editingId, setEditingId] = useState<string | null>();
  const [confirmId, setConfirmId] = useState<string>();
  const [message, setMessage] = useState('');
  const [previewId, setPreviewId] = useState<string>();
  const [measureFill, fillHeight] = useFillHeight<HTMLDivElement>();

  if (editingId !== undefined) {
    const round = rounds.data?.find((item) => item.id === editingId);
    const sharedIds = new Set(
      rounds.data
        ?.filter((item) => item.id !== editingId && item.status === 'active')
        .flatMap(
          (item) => item.currentVersion?.checkpoints.map(({ checkpoint }) => checkpoint.id) ?? [],
        ),
    );
    return points.isPending ? (
      <p role="status">Cargando puntos…</p>
    ) : (
      <RoundEditor
        key={editingId ?? 'nueva'}
        siteId={site.id}
        points={points.data ?? []}
        round={round}
        sharedIds={sharedIds}
        onClose={(saved) => {
          setEditingId(undefined);
          if (saved) {
            setMessage(saved);
            void rounds.refetch();
          }
        }}
      />
    );
  }

  const located = (points.data ?? []).flatMap((p) =>
    p.latitude !== undefined && p.longitude !== undefined
      ? [{ id: p.id, name: p.name, lat: p.latitude, lng: p.longitude }]
      : [],
  );
  const preview = rounds.data?.find((round) => round.id === previewId) ?? rounds.data?.[0];
  const previewIds =
    preview?.currentVersion?.checkpoints.map(({ checkpoint }) => checkpoint.id) ?? [];
  const previewCoords = previewIds.flatMap((id) => {
    const point = located.find((p) => p.id === id);
    return point ? [[point.lng, point.lat] as LngLat] : [];
  });
  const previewRoute =
    storedRouteInput(preview?.currentVersion?.route) ?? defaultRouteInput(previewIds.length);
  const previewDisplay =
    storedRoute(preview?.currentVersion?.route) ??
    resolveRoute(previewRoute, previewCoords, new Map()).display;

  return (
    <section
      aria-labelledby={`rounds-${site.id}`}
      className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id={`rounds-${site.id}`} className="sr-only">
            Rondas
          </h3>
          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
          {canWrite && (
            <Button
              className="ml-auto"
              onClick={() => {
                setMessage('');
                setEditingId(null);
              }}
            >
              Nueva ronda
            </Button>
          )}
        </div>
        {rounds.isPending ? (
          <p role="status">Cargando rondas…</p>
        ) : rounds.isError ? (
          <Alert variant="destructive">No se pudieron cargar las rondas.</Alert>
        ) : rounds.data.length === 0 ? (
          <EmptyState
            title="Todavía no hay rondas"
            description="Creá una ronda para elegir sus puntos y trazar el recorrido en el mapa."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th scope="col" className="t-label h-9 px-4 text-left">
                    Ronda
                  </th>
                  <th scope="col" className="t-label px-4 text-left">
                    Franja
                  </th>
                  <th scope="col" className="t-label px-4 text-left">
                    Puntos
                  </th>
                  <th scope="col" className="t-label px-4 text-left">
                    Recorrido
                  </th>
                  <th scope="col" className="t-label px-4 text-left">
                    Estado
                  </th>
                  <th scope="col" className="px-4">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rounds.data.map((round) => {
                  const version = round.currentVersion;
                  const traced = roundRouteSchema.safeParse(version?.route).success;
                  return (
                    <tr
                      key={round.id}
                      className={cn(
                        'border-t border-border align-middle',
                        round.id === preview?.id && 'bg-muted',
                      )}
                    >
                      <td className="h-14 px-4">
                        <button
                          type="button"
                          aria-pressed={round.id === preview?.id}
                          className="text-left font-semibold underline-offset-4 hover:underline"
                          onClick={() => {
                            setPreviewId(round.id);
                          }}
                        >
                          {round.name}
                        </button>
                      </td>
                      <td className="px-4 tabular-nums">
                        {version?.windowStartLocal}–{version?.windowEndLocal} · cada{' '}
                        {version?.frequencyMinutes} min
                      </td>
                      <td className="px-4 tabular-nums">{version?.checkpoints.length ?? 0}</td>
                      <td className="px-4">
                        <StatusBadge tone={traced ? 'info' : 'neutral'}>
                          {traced ? 'Trazado' : 'Sin trazar'}
                        </StatusBadge>
                      </td>
                      <td className="px-4">
                        <StatusBadge tone={round.status === 'active' ? 'success' : 'neutral'}>
                          {round.status === 'active' ? 'Activo' : 'Inactivo'}
                        </StatusBadge>
                      </td>
                      <td className="px-4 text-right whitespace-nowrap">
                        {round.status === 'active' && canWrite && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Editar ${round.name}`}
                              onClick={() => {
                                setMessage('');
                                setEditingId(round.id);
                              }}
                            >
                              Editar
                            </Button>
                            <Button
                              variant="ghostDestructive"
                              size="sm"
                              aria-label={`Dar de baja ${round.name}`}
                              onClick={() => {
                                setConfirmId(round.id);
                              }}
                            >
                              Dar de baja
                            </Button>
                          </>
                        )}
                        {confirmId === round.id && (
                          <Alert
                            role="alertdialog"
                            aria-label="Confirmar baja"
                            className="mt-2 space-y-3 border-warning bg-warning-soft text-left text-warning"
                          >
                            <p>¿Dar de baja {round.name}?</p>
                            <div className="flex gap-2">
                              <Button
                                variant="destructive"
                                onClick={() => {
                                  setConfirmId(undefined);
                                  void apiPost(
                                    `/rondas/${round.id}/baja`,
                                    {},
                                    z.object({}),
                                    idSchema,
                                  )
                                    .then(() => rounds.refetch())
                                    .catch(() => {
                                      setMessage(
                                        'No se pudo dar de baja la ronda. Intentá de nuevo.',
                                      );
                                    });
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
                            </div>
                          </Alert>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* El recorrido de la ronda elegida, a la vista sin entrar al editor. */}
      <div
        aria-label={preview ? `Recorrido de ${preview.name}` : 'Puntos del predio'}
        ref={measureFill}
        style={{ height: fillHeight }}
        className="overflow-hidden rounded-md border border-border xl:sticky xl:top-4"
      >
        {located.length > 0 && previewCoords.length === previewIds.length && (
          <RouteEditor
            points={located}
            selected={previewIds}
            route={previewRoute}
            display={previewDisplay}
          />
        )}
      </div>
    </section>
  );
}
