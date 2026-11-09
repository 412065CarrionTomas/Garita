/* eslint react-refresh/only-export-components: off */
import {
  INCIDENT_TYPE_LABELS,
  INCIDENT_TYPES,
  incidentClassificationSchema,
  incidentReclassificationSchema,
} from '@garita/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { SyntheticEvent } from 'react';
import { Link, useParams } from 'react-router';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Stamp } from '@/components/stamp';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { apiGet, apiPost } from '@/lib/api-client';
import { env } from '@/config/env';
import { cn } from '@/lib/utils';

const rowSchema = z.object({
  id: z.string(),
  type: z.enum(INCIDENT_TYPES),
  description: z.string().nullable(),
  createdAt: z.string(),
  site: z.object({ id: z.string(), name: z.string() }),
  guard: z.object({ firstName: z.string(), lastName: z.string(), status: z.string() }),
  classificationStatus: z.enum(['pending', 'client_visible', 'internal']).optional(),
  overdue: z.boolean().optional(),
});
const queueSchema = z.array(rowSchema);
const listSchema = z.object({
  items: z.array(rowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
const countSchema = z.object({ count: z.number() });
const detailSchema = rowSchema.extend({
  classificationStatus: z.enum(['pending', 'client_visible', 'internal']),
  guard: z.object({ name: z.string() }),
  occurredAtDevice: z.string(),
  latitude: z.coerce.number().nullable(),
  longitude: z.coerce.number().nullable(),
  photos: z.array(z.object({ id: z.string(), thumbnailUrl: z.url(), fullUrl: z.url() })),
  classifications: z.array(
    z.object({
      id: z.string(),
      classification: z.enum(['client_visible', 'internal']),
      internalComment: z.string(),
      clientNote: z.string().nullable(),
      reason: z.string().nullable(),
      decidedAt: z.string(),
      decidedBy: z.object({ firstName: z.string(), lastName: z.string() }),
    }),
  ),
});
const decisionResponseSchema = z.object({
  classificationStatus: z.enum(['client_visible', 'internal']),
  decidedAt: z.string(),
});

const statusText = {
  pending: 'Sin clasificar',
  client_visible: 'Visible al cliente',
  internal: 'Interno',
} as const;

function ListSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="space-y-2">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}
function IncidentStatus({ status }: { status: keyof typeof statusText }) {
  return (
    <StatusBadge
      tone={status === 'pending' ? 'warning' : status === 'internal' ? 'neutral' : 'success'}
    >
      {statusText[status]}
    </StatusBadge>
  );
}

export function useIncidentPendingCount(enabled: boolean) {
  return useQuery({
    queryKey: ['incidents', 'count'],
    queryFn: () => apiGet('/incidentes/cola/cantidad', countSchema),
    refetchInterval: 30_000,
    enabled,
  });
}

function IncidentRows({
  rows,
  selectedId,
  onSelect,
}: {
  rows: z.infer<typeof rowSchema>[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  if (!rows.length)
    return (
      <EmptyState
        title="No hay incidentes por revisar"
        description="Cuando un vigilador reporte uno, aparece acá."
      />
    );
  return (
    <ul className="divide-y divide-border border-[1.5px] border-input">
      {rows.map((incident) => {
        const info = (
          <>
            <span className="block font-semibold">
              {INCIDENT_TYPE_LABELS[incident.type]} · {incident.site.name}
            </span>
            <span className="block text-sm text-muted-foreground tabular-nums">
              {incident.guard.firstName} {incident.guard.lastName}
              {incident.guard.status === 'deactivated' ? ' (desactivado)' : ''} ·{' '}
              {new Date(incident.createdAt).toLocaleString('es-AR')}
            </span>
          </>
        );
        return (
          <li
            key={incident.id}
            className={cn(
              'flex flex-wrap items-center justify-between gap-3 px-3 py-3',
              selectedId === incident.id && 'bg-muted',
            )}
          >
            {onSelect ? (
              <button
                type="button"
                aria-pressed={selectedId === incident.id}
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  onSelect(incident.id);
                }}
              >
                {info}
              </button>
            ) : (
              <div className="min-w-0 flex-1">{info}</div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {incident.overdue && <StatusBadge tone="warning">Más de 24 h pendiente</StatusBadge>}
              {incident.classificationStatus && (
                <IncidentStatus status={incident.classificationStatus} />
              )}
              <Button asChild variant="outline" size="sm">
                <Link to={`/incidentes/${incident.id}`}>Ver detalle</Link>
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function IncidentsQueuePage() {
  const queue = useQuery({
    queryKey: ['incidents', 'queue'],
    queryFn: () => apiGet('/incidentes/cola', queueSchema),
    refetchInterval: 30_000,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <main className="space-y-6">
      <PageHeader
        title="Revisión de incidentes"
        description="Decidí quién ve cada incidente: solo la empresa o también el cliente del predio."
        actions={
          <Button asChild variant="outline">
            <Link to="/incidentes">Ver todos los incidentes</Link>
          </Button>
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div>
          {queue.isPending ? (
            <ListSkeleton label="Cargando cola…" />
          ) : queue.isError ? (
            <Alert variant="destructive">
              No se pudo cargar la cola.{' '}
              <Button variant="outline" size="sm" onClick={() => void queue.refetch()}>
                Reintentar
              </Button>
            </Alert>
          ) : (
            <IncidentRows rows={queue.data} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </div>
        <div className="border-[1.5px] border-input p-4 lg:sticky lg:top-4">
          {selectedId ? (
            <IncidentDetail key={selectedId} id={selectedId} embedded />
          ) : (
            <p className="text-sm text-muted-foreground">
              Elegí un incidente de la lista para ver el detalle.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

export function IncidentsListPage() {
  const [filters, setFilters] = useState({
    predio: '',
    desde: '',
    hasta: '',
    tipo: '',
    clasificacion: '',
    pagina: 1,
  });
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, String(value));
  const list = useQuery({
    queryKey: ['incidents', 'list', filters],
    queryFn: () => apiGet(`/incidentes?${params}`, listSchema),
  });
  const sites = useQuery({
    queryKey: ['sites'],
    queryFn: () => apiGet('/predios', z.array(z.looseObject({ id: z.string(), name: z.string() }))),
  });
  const update = (key: keyof typeof filters, value: string) => {
    setFilters((old) => ({ ...old, [key]: value, pagina: 1 }));
  };
  return (
    <main className="space-y-6">
      <PageHeader
        title="Incidentes"
        description="Consulta y clasificación de reportes"
        actions={
          <Button asChild variant="outline">
            <Link to="/incidentes/cola">Ir a la cola</Link>
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <Label htmlFor="incident-site">Predio</Label>
          <NativeSelect
            id="incident-site"
            value={filters.predio}
            onChange={(event) => {
              update('predio', event.target.value);
            }}
          >
            <NativeSelectOption value="">Todos</NativeSelectOption>
            {sites.data?.map((site) => (
              <NativeSelectOption key={site.id} value={site.id}>
                {site.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="incident-from">Desde</Label>
          <Input
            id="incident-from"
            type="date"
            value={filters.desde}
            onChange={(event) => {
              update('desde', event.target.value);
            }}
          />
        </div>
        <div>
          <Label htmlFor="incident-to">Hasta</Label>
          <Input
            id="incident-to"
            type="date"
            value={filters.hasta}
            onChange={(event) => {
              update('hasta', event.target.value);
            }}
          />
        </div>
        <div>
          <Label htmlFor="incident-type">Tipo</Label>
          <NativeSelect
            id="incident-type"
            value={filters.tipo}
            onChange={(event) => {
              update('tipo', event.target.value);
            }}
          >
            <NativeSelectOption value="">Todos</NativeSelectOption>
            {INCIDENT_TYPES.map((type) => (
              <NativeSelectOption key={type} value={type}>
                {INCIDENT_TYPE_LABELS[type]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="incident-status">Estado</Label>
          <NativeSelect
            id="incident-status"
            value={filters.clasificacion}
            onChange={(event) => {
              update('clasificacion', event.target.value);
            }}
          >
            <NativeSelectOption value="">Todos</NativeSelectOption>
            {Object.entries(statusText).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      {list.isPending ? (
        <ListSkeleton label="Cargando incidentes…" />
      ) : list.isError ? (
        <Alert variant="destructive">
          No se pudieron cargar los incidentes.{' '}
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            Reintentar
          </Button>
        </Alert>
      ) : (
        <>
          <IncidentRows rows={list.data.items} />
          <nav aria-label="Páginas de incidentes" className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={filters.pagina <= 1}
              onClick={() => {
                setFilters((old) => ({ ...old, pagina: old.pagina - 1 }));
              }}
            >
              Anterior
            </Button>
            <span>
              Página {filters.pagina} de{' '}
              {Math.max(1, Math.ceil(list.data.total / list.data.pageSize))}
            </span>
            <Button
              variant="outline"
              disabled={filters.pagina * list.data.pageSize >= list.data.total}
              onClick={() => {
                setFilters((old) => ({ ...old, pagina: old.pagina + 1 }));
              }}
            >
              Siguiente
            </Button>
          </nav>
        </>
      )}
    </main>
  );
}

function DecisionDialog({
  id,
  reclassify,
  onClose,
}: {
  id: string;
  reclassify: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [classification, setClassification] = useState<'client_visible' | 'internal'>(
    'client_visible',
  );
  const [internalComment, setInternalComment] = useState('');
  const [clientNote, setClientNote] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      apiPost(
        `/incidentes/${id}/${reclassify ? 'reclasificar' : 'clasificar'}`,
        body,
        reclassify ? incidentReclassificationSchema : incidentClassificationSchema,
        decisionResponseSchema,
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['incidents'] });
      onClose();
    },
  });
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const parsed = (
      reclassify ? incidentReclassificationSchema : incidentClassificationSchema
    ).safeParse({
      classification,
      internalComment,
      ...(classification === 'client_visible' && clientNote ? { clientNote } : {}),
      ...(reclassify ? { reason } : {}),
    });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      return;
    }
    setErrors({});
    mutation.mutate(parsed.data);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>{reclassify ? 'Reclasificar incidente' : 'Clasificar incidente'}</DialogTitle>
        <DialogDescription>
          La decisión y su autor quedarán registrados en el historial.
        </DialogDescription>
        <form
          onSubmit={submit}
          aria-label={reclassify ? 'Reclasificar incidente' : 'Clasificar incidente'}
          className="space-y-4"
        >
          <fieldset className="space-y-2">
            <legend className="t-label mb-1 text-muted-foreground">Quién ve</legend>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {(
                [
                  ['internal', 'Interno', 'Solo lo ve la empresa.'],
                  ['client_visible', 'Visible al cliente', 'Lo verá el cliente del predio.'],
                ] as const
              ).map(([value, title, hint]) => (
                <label
                  key={value}
                  className="relative grid cursor-pointer gap-0.5 rounded-md border-[1.5px] border-input px-3.5 py-3 has-[:checked]:bg-muted has-[:checked]:ring-2 has-[:checked]:ring-inset has-[:checked]:ring-primary has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
                >
                  <input
                    type="radio"
                    name="classification"
                    value={value}
                    checked={classification === value}
                    onChange={() => {
                      setClassification(value);
                    }}
                    className="absolute opacity-0"
                  />
                  <span className="font-bold">{title}</span>
                  <span className="text-sm text-muted-foreground">{hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <Label htmlFor="internal-comment">Comentario interno</Label>
            <Textarea
              id="internal-comment"
              value={internalComment}
              onChange={(event) => {
                setInternalComment(event.target.value);
              }}
              aria-invalid={!!errors.internalComment}
              aria-describedby={errors.internalComment ? 'internal-comment-error' : undefined}
            />
            <p id="internal-comment-error" className="text-sm text-danger">
              {errors.internalComment}
            </p>
          </div>
          {classification === 'client_visible' && (
            <div>
              <Label htmlFor="client-note">Nota para el cliente (opcional)</Label>
              <Textarea
                id="client-note"
                value={clientNote}
                onChange={(event) => {
                  setClientNote(event.target.value);
                }}
                aria-invalid={!!errors.clientNote}
                aria-describedby={errors.clientNote ? 'client-note-error' : undefined}
              />
              <p id="client-note-error" className="text-sm text-danger">
                {errors.clientNote}
              </p>
            </div>
          )}
          {reclassify && (
            <div>
              <Label htmlFor="reason">Motivo del cambio</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
                aria-invalid={!!errors.reason}
                aria-describedby={errors.reason ? 'reason-error' : undefined}
              />
              <p id="reason-error" className="text-sm text-danger">
                {errors.reason}
              </p>
            </div>
          )}
          {mutation.isError && (
            <Alert variant="destructive">
              No se pudo guardar la clasificación. Revisá el estado del incidente.
            </Alert>
          )}
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending
              ? 'Guardando…'
              : reclassify
                ? 'Cambiar clasificación'
                : 'Confirmar clasificación'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IncidentDetailPage() {
  const { id } = useParams();
  return id ? <IncidentDetail id={id} /> : null;
}

function IncidentDetail({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ['incidents', 'detail', id],
    queryFn: () => apiGet(`/incidentes/${id}`, detailSchema),
  });
  if (detail.isPending) return <ListSkeleton label="Cargando incidente…" />;
  if (detail.isError)
    return (
      <Alert variant="destructive">
        No se pudo cargar el incidente.{' '}
        <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
          Reintentar
        </Button>
      </Alert>
    );
  const incident = detail.data;
  const lat = incident.latitude;
  const lng = incident.longitude;
  const when = new Date(incident.occurredAtDevice);
  const whenText = when.toLocaleString('es-AR');
  const title = INCIDENT_TYPE_LABELS[incident.type];
  const subtitle = `${incident.site.name} · ${whenText}`;
  const Root = embedded ? 'div' : 'main';
  return (
    <Root className="space-y-6">
      {embedded ? (
        <header className="space-y-1">
          <h2 className="t-headline text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </header>
      ) : (
        <PageHeader
          title={title}
          description={subtitle}
          actions={
            <Button asChild variant="outline">
              <Link to="/incidentes">Volver a incidentes</Link>
            </Button>
          }
        />
      )}
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="space-y-1">
          <dt className="t-label text-muted-foreground">Estado</dt>
          <dd>
            <IncidentStatus status={incident.classificationStatus} />
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="t-label text-muted-foreground">Hora</dt>
          <dd>
            <Stamp>
              {when.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
            </Stamp>
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="t-label text-muted-foreground">Vigilador</dt>
          <dd>{incident.guard.name}</dd>
        </div>
        <div className="space-y-1">
          <dt className="t-label text-muted-foreground">Fotos</dt>
          <dd className="tabular-nums">{incident.photos.length}</dd>
        </div>
      </dl>
      {/* TODO(foja): la API no expone el punto ni la ronda del incidente. */}
      <p>{incident.description ?? 'Sin descripción'}</p>
      <section aria-label="Ubicación" className="space-y-2">
        <h2 className="t-label text-muted-foreground">Ubicación</h2>
        {lat === null || lng === null ? (
          <p>No se registró ubicación.</p>
        ) : (
          <>
            <p className="tabular-nums">
              Coordenadas: {lat}, {lng}
            </p>
            {env.VITE_GOOGLE_MAPS_API_KEY ? (
              <iframe
                title="Mapa de ubicación del incidente"
                className="h-64 w-full rounded-lg border-[1.5px] border-input"
                src={`https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(env.VITE_GOOGLE_MAPS_API_KEY)}&q=${lat},${lng}`}
              />
            ) : (
              <Alert variant="neutral" role="status">
                El mapa no está configurado; consultá las coordenadas indicadas.
              </Alert>
            )}
          </>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="t-label text-muted-foreground">Fotos</h2>
        {incident.photos.length ? (
          <ul className="flex flex-wrap gap-3">
            {incident.photos.map((photo) => (
              <li key={photo.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPhotoUrl(photo.fullUrl);
                  }}
                  aria-label={`Ampliar foto de ${title} a las ${whenText}`}
                >
                  <img
                    src={photo.thumbnailUrl}
                    alt={`${title} a las ${whenText}`}
                    className="h-32 w-32 rounded-lg border-[1.5px] border-input bg-muted object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>Sin fotos.</p>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="t-label text-muted-foreground">Historial de clasificación</h2>
        {incident.classifications.length ? (
          <ol className="space-y-3">
            {incident.classifications.map((entry) => (
              <li key={entry.id} className="space-y-1 border-[1.5px] border-input p-3">
                <IncidentStatus status={entry.classification} />
                <p className="tabular-nums">
                  {entry.decidedBy.firstName} {entry.decidedBy.lastName} ·{' '}
                  {new Date(entry.decidedAt).toLocaleString('es-AR')}
                </p>
                <p>Comentario interno: {entry.internalComment}</p>
                {entry.clientNote && <p>Nota para el cliente: {entry.clientNote}</p>}
                {entry.reason && <p>Motivo: {entry.reason}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p>Sin decisiones todavía.</p>
        )}
      </section>
      <Button
        onClick={() => {
          setDialogOpen(true);
        }}
      >
        {incident.classificationStatus === 'pending' ? 'Clasificar' : 'Reclasificar'}
      </Button>
      {dialogOpen && (
        <DecisionDialog
          id={id}
          reclassify={incident.classificationStatus !== 'pending'}
          onClose={() => {
            setDialogOpen(false);
          }}
        />
      )}
      {photoUrl && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setPhotoUrl(null);
          }}
        >
          <DialogContent>
            <DialogTitle>Foto del incidente</DialogTitle>
            <DialogDescription>
              {title} · {whenText}
            </DialogDescription>
            <img
              src={photoUrl}
              alt={`${title} a las ${whenText}`}
              className="max-h-[70vh] w-full object-contain"
            />
          </DialogContent>
        </Dialog>
      )}
    </Root>
  );
}
