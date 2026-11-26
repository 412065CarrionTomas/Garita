import { useQuery } from '@tanstack/react-query';
import {
  defaultRouteInput,
  previewWindows,
  roundRouteSchema,
  speedProfileSchema,
  type LngLat,
} from '@garita/shared';
import { Copy, EllipsisVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useRef, useState, type CSSProperties } from 'react';
import { z } from 'zod';
import { ColumnResizer } from '@/components/column-resizer';
import { EmptyState } from '@/components/empty-state';
import { FloatingNotice } from '@/components/floating-notice';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { apiGet, apiPost } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';
import { cn } from '@/lib/utils';
import { useColumnWidth } from '@/lib/use-column-width';
import { useFillHeight } from '@/lib/use-fill-height';
import { useFloatingNotice } from '@/lib/use-floating-notice';
import { RoundEditor } from './round-editor';
import { RouteEditor } from './route-editor';
import {
  formatMeters,
  legMeters,
  resolveRoute,
  storedRoute,
  storedRouteInput,
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
    scheduledShifts: z.number().optional(),
    currentVersion: z
      .looseObject({
        frequencyMinutes: z.number(),
        windowStartLocal: z.string(),
        windowEndLocal: z.string(),
        graceMinutes: z.number(),
        route: z.unknown().optional(),
        speedProfile: speedProfileSchema.nullish(),
        maxSpeedKmh: z.number().nullish(),
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
  // Con `editingId`: crea una ronda nueva con los datos de esa (Duplicar).
  const [copying, setCopying] = useState(false);
  const edit = (id: string | null | undefined, copy = false) => {
    setEditingId(id);
    setCopying(copy);
  };
  // Ancho de la lista en % del panel; el mapa toma el resto.
  const sectionRef = useRef<HTMLElement>(null);
  const listColumn = useColumnWidth('garita.rondas.ancho-lista', 50, 25, 75);
  const [confirmId, setConfirmId] = useState<string>();
  const { notice, notify, close: closeNotice } = useFloatingNotice();
  const [previewId, setPreviewId] = useState<string>();
  const [measureFill, fillHeight] = useFillHeight<HTMLElement>();
  // Estable: un ref nuevo en cada render volvería a medir en cada movimiento del separador.
  const setSection = useCallback(
    (element: HTMLElement | null) => {
      sectionRef.current = element;
      measureFill(element);
    },
    [measureFill],
  );

  if (editingId !== undefined) {
    const round = rounds.data?.find((item) => item.id === editingId);
    const sharedIds = new Set(
      rounds.data
        // Al duplicar, los puntos de la original también quedan compartidos con la copia.
        ?.filter((item) => (copying || item.id !== editingId) && item.status === 'active')
        .flatMap(
          (item) => item.currentVersion?.checkpoints.map(({ checkpoint }) => checkpoint.id) ?? [],
        ),
    );
    return points.isPending ? (
      <p role="status">Cargando puntos…</p>
    ) : (
      <RoundEditor
        key={`${editingId ?? 'nueva'}-${String(copying)}`}
        siteId={site.id}
        points={points.data ?? []}
        round={round}
        copy={copying}
        sharedIds={sharedIds}
        onClose={(saved) => {
          edit(undefined);
          if (saved) {
            notify(saved);
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
  // Activas primero: las dadas de baja quedan al final, atenuadas.
  const ordered = [...(rounds.data ?? [])].sort(
    (a, b) => Number(a.status !== 'active') - Number(b.status !== 'active'),
  );
  const preview = ordered.find((round) => round.id === previewId) ?? ordered[0];
  const previewIds =
    preview?.currentVersion?.checkpoints.map(({ checkpoint }) => checkpoint.id) ?? [];
  const previewCoords = previewIds.flatMap((id) => {
    const point = located.find((p) => p.id === id);
    return point ? [[point.lng, point.lat] as LngLat] : [];
  });
  const previewRoute =
    storedRouteInput(preview?.currentVersion?.route) ?? defaultRouteInput(previewIds.length);
  const previewStored = storedRoute(preview?.currentVersion?.route);
  const previewDisplay =
    previewStored ?? resolveRoute(previewRoute, previewCoords, new Map()).display;

  const routeMeters = previewStored
    ? legMeters(previewStored).reduce((sum, m) => sum + m, 0)
    : undefined;
  const confirming = rounds.data?.find((round) => round.id === confirmId);

  return (
    <section
      ref={setSection}
      aria-labelledby={`rounds-${site.id}`}
      // En pantalla ancha el panel ocupa justo hasta el borde de abajo: scrollea la lista, no la página.
      style={
        {
          '--list': `${String(listColumn.width)}%`,
          '--fill': fillHeight === undefined ? undefined : `${String(fillHeight)}px`,
        } as CSSProperties
      }
      className="grid items-start gap-4 xl:h-(--fill) xl:grid-cols-[minmax(0,var(--list))_auto_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)] xl:items-stretch xl:gap-x-1"
    >
      <div className="grid content-start gap-3 xl:flex xl:min-h-0 xl:flex-col">
        <div className="flex flex-wrap items-center gap-3">
          <h3
            id={`rounds-${site.id}`}
            className="font-cond text-lg font-semibold tracking-wider uppercase"
          >
            Rondas
            {rounds.data && (
              <span className="ml-2 text-muted-foreground tabular-nums">{rounds.data.length}</span>
            )}
          </h3>
          {canWrite && (
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => {
                edit(null);
              }}
            >
              <Plus aria-hidden="true" />
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
          <ul
            aria-label="Rondas del predio"
            className="grid content-start gap-2 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1"
          >
            {ordered.map((round) => {
              const version = round.currentVersion;
              const traced = roundRouteSchema.safeParse(version?.route).success;
              const active = round.status === 'active';
              const chosen = round.id === preview?.id;
              const windows = version
                ? previewWindows({
                    windowStartLocal: version.windowStartLocal,
                    windowEndLocal: version.windowEndLocal,
                    frequencyMinutes: version.frequencyMinutes,
                  }).length
                : 0;
              const count = version?.checkpoints.length ?? 0;
              return (
                <li
                  key={round.id}
                  className={cn(
                    'flex items-start rounded-md border-[1.5px] bg-card',
                    chosen ? 'border-primary' : 'border-border',
                  )}
                >
                  {/* Elegir la ronda la muestra en el mapa; la barra marca cuál es, no solo el color. */}
                  <button
                    type="button"
                    aria-pressed={chosen}
                    className={cn(
                      'min-w-0 flex-1 rounded-l-sm border-l-4 px-4 py-3 text-left hover:bg-muted',
                      chosen ? 'border-l-primary' : 'border-l-transparent',
                    )}
                    onClick={() => {
                      setPreviewId(round.id);
                    }}
                  >
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className={cn('font-semibold', !active && 'text-muted-foreground')}>
                        {round.name}
                      </span>
                      {!active && <StatusBadge tone="neutral">Inactiva</StatusBadge>}
                    </span>
                    {version && (
                      <span className="mt-1 block text-sm text-muted-foreground tabular-nums">
                        {version.windowStartLocal === version.windowEndLocal
                          ? 'Todo el día'
                          : `${version.windowStartLocal}–${version.windowEndLocal}`}{' '}
                        · cada {version.frequencyMinutes} min · {windows}{' '}
                        {windows === 1 ? 'ventana' : 'ventanas'}
                      </span>
                    )}
                    <span className="block text-sm text-muted-foreground tabular-nums">
                      {count} {count === 1 ? 'punto' : 'puntos'} ·{' '}
                      {traced ? 'Con recorrido' : 'Sin recorrido'}
                    </span>
                  </button>
                  {/* Una inactiva solo se puede duplicar: así se recupera con otro nombre. */}
                  {canWrite && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Acciones de ${round.name}`}
                          className="m-2"
                        >
                          <EllipsisVertical aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {active && (
                          <DropdownMenuItem
                            onSelect={() => {
                              edit(round.id);
                            }}
                          >
                            <Pencil aria-hidden="true" />
                            Editar
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onSelect={() => {
                            edit(round.id, true);
                          }}
                        >
                          <Copy aria-hidden="true" />
                          Duplicar
                        </DropdownMenuItem>
                        {active && (
                          <DropdownMenuItem
                            className="text-danger focus:text-danger"
                            onSelect={() => {
                              setConfirmId(round.id);
                            }}
                          >
                            <Trash2 aria-hidden="true" />
                            Dar de baja
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ColumnResizer
        label="Ancho de la lista de rondas"
        container={sectionRef}
        column={listColumn}
        className="hidden xl:flex"
      />
      {/* El recorrido de la ronda elegida, a la vista sin entrar al editor. */}
      <div className="flex h-(--fill) flex-col overflow-hidden rounded-md border border-border bg-card xl:h-auto">
        <div className="flex items-baseline gap-3 border-b border-border px-4 py-2">
          <h4 className="t-label min-w-0 truncate">
            {preview ? `Recorrido · ${preview.name}` : 'Puntos del predio'}
          </h4>
          {routeMeters !== undefined && (
            <span className="ml-auto t-stamp tabular-nums">{formatMeters(routeMeters)}</span>
          )}
        </div>
        <div
          aria-label={preview ? `Recorrido de ${preview.name}` : 'Puntos del predio'}
          className="relative min-h-0 flex-1"
        >
          {/* Con el recorrido guardado se dibuja aunque falte algún punto (dado de baja después). */}
          {located.length > 0 &&
            (previewStored !== null || previewCoords.length === previewIds.length) && (
              <RouteEditor
                scope={preview?.id}
                points={located}
                selected={previewIds}
                route={previewRoute}
                display={previewDisplay}
              />
            )}
        </div>
      </div>
      <AlertDialog
        open={confirming !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirmId(undefined);
        }}
      >
        <AlertDialogContent className="space-y-4">
          <AlertDialogTitle className="text-lg font-semibold">
            Dar de baja la ronda
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground">
            ¿Dar de baja {confirming?.name}? Deja de programarse en los turnos futuros.
          </AlertDialogDescription>
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancelar</Button>
            </AlertDialogCancel>
            <AlertDialogAction
              asChild
              onClick={() => {
                if (!confirming) return;
                void apiPost(`/rondas/${confirming.id}/baja`, {}, z.object({}), idSchema)
                  .then(() => rounds.refetch())
                  .catch(() => {
                    notify('No se pudo dar de baja la ronda. Intentá de nuevo.', 'danger');
                  });
              }}
            >
              <Button variant="destructive">Confirmar baja</Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
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
