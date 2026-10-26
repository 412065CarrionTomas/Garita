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
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { apiGet, apiPost } from '@/lib/api-client';
import { env } from '@/config/env';

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
  pending: 'Pendiente de clasificación',
  client_visible: 'Visible para el cliente',
  internal: 'Interno',
} as const;
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

function IncidentRows({ rows }: { rows: z.infer<typeof rowSchema>[] }) {
  if (!rows.length) return <EmptyState title="No hay incidentes para mostrar" />;
  return (
    <ul className="space-y-3">
      {rows.map((incident) => (
        <li key={incident.id}>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="font-medium">
                  {INCIDENT_TYPE_LABELS[incident.type]} · {incident.site.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {new Date(incident.createdAt).toLocaleString('es-AR')} ·{' '}
                  {incident.guard.firstName} {incident.guard.lastName}
                  {incident.guard.status === 'deactivated' ? ' (desactivado)' : ''}
                </p>
                {incident.overdue && (
                  <StatusBadge tone="warning">Más de 24 h pendiente</StatusBadge>
                )}
                {incident.classificationStatus && (
                  <IncidentStatus status={incident.classificationStatus} />
                )}
              </div>
              <Button asChild variant="outline">
                <Link to={`/incidentes/${incident.id}`}>Ver detalle</Link>
              </Button>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function IncidentsQueuePage() {
  const queue = useQuery({
    queryKey: ['incidents', 'queue'],
    queryFn: () => apiGet('/incidentes/cola', queueSchema),
    refetchInterval: 30_000,
  });
  return (
    <main className="space-y-6">
      <PageHeader
        title="Cola de clasificación"
        description="Incidentes pendientes, del más antiguo al más reciente"
      />
      <Link className="text-sm underline" to="/incidentes">
        Ver todos los incidentes
      </Link>
      {queue.isPending ? (
        <p role="status">Cargando cola…</p>
      ) : queue.isError ? (
        <Alert>No se pudo cargar la cola.</Alert>
      ) : (
        <IncidentRows rows={queue.data} />
      )}
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
      <PageHeader title="Incidentes" description="Consulta y clasificación de reportes" />
      <Link className="text-sm underline" to="/incidentes/cola">
        Ir a la cola
      </Link>
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
        <p role="status">Cargando incidentes…</p>
      ) : list.isError ? (
        <Alert>No se pudieron cargar los incidentes.</Alert>
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
          <div>
            <Label htmlFor="decision">Clasificación</Label>
            <NativeSelect
              id="decision"
              value={classification}
              onChange={(event) => {
                setClassification(event.target.value as typeof classification);
              }}
            >
              <NativeSelectOption value="client_visible">
                Visible para el cliente
              </NativeSelectOption>
              <NativeSelectOption value="internal">Interno</NativeSelectOption>
            </NativeSelect>
          </div>
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
            <p id="internal-comment-error" className="text-sm text-destructive">
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
              <p id="client-note-error" className="text-sm text-destructive">
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
              <p id="reason-error" className="text-sm text-destructive">
                {errors.reason}
              </p>
            </div>
          )}
          {mutation.isError && (
            <Alert>No se pudo guardar la clasificación. Revisá el estado del incidente.</Alert>
          )}
          <Button type="submit" disabled={mutation.isPending}>
            Guardar clasificación
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IncidentDetailPage() {
  const { id } = useParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ['incidents', 'detail', id],
    queryFn: () => apiGet(`/incidentes/${id}`, detailSchema),
    enabled: !!id,
  });
  if (detail.isPending) return <p role="status">Cargando incidente…</p>;
  if (detail.isError) return <Alert>No se pudo cargar el incidente.</Alert>;
  const incident = detail.data;
  const lat = incident.latitude;
  const lng = incident.longitude;
  return (
    <main className="space-y-6">
      <PageHeader
        title={INCIDENT_TYPE_LABELS[incident.type]}
        description={`${incident.site.name} · ${new Date(incident.occurredAtDevice).toLocaleString('es-AR')}`}
      />
      <Link className="text-sm underline" to="/incidentes">
        Volver a incidentes
      </Link>
      <IncidentStatus status={incident.classificationStatus} />
      <p>{incident.description ?? 'Sin descripción'}</p>
      <p>Vigilador: {incident.guard.name}</p>
      <section aria-label="Ubicación" className="space-y-2">
        <h2 className="text-lg font-semibold">Ubicación</h2>
        {lat === null || lng === null ? (
          <p>No se registró ubicación.</p>
        ) : (
          <>
            <p>
              Coordenadas: {lat}, {lng}
            </p>
            {env.VITE_GOOGLE_MAPS_API_KEY ? (
              <iframe
                title="Mapa de ubicación del incidente"
                className="h-64 w-full rounded-lg border"
                src={`https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(env.VITE_GOOGLE_MAPS_API_KEY)}&q=${lat},${lng}`}
              />
            ) : (
              <p role="status">El mapa no está configurado; consultá las coordenadas indicadas.</p>
            )}
          </>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Fotos</h2>
        {incident.photos.length ? (
          <ul className="flex flex-wrap gap-3">
            {incident.photos.map((photo) => (
              <li key={photo.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPhotoUrl(photo.fullUrl);
                  }}
                  aria-label={`Ampliar foto de ${INCIDENT_TYPE_LABELS[incident.type]} a las ${new Date(incident.occurredAtDevice).toLocaleString('es-AR')}`}
                >
                  <img
                    src={photo.thumbnailUrl}
                    alt={`${INCIDENT_TYPE_LABELS[incident.type]} a las ${new Date(incident.occurredAtDevice).toLocaleString('es-AR')}`}
                    className="h-32 w-32 rounded-lg object-cover"
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
        <h2 className="text-lg font-semibold">Historial de clasificación</h2>
        {incident.classifications.length ? (
          <ol className="space-y-3">
            {incident.classifications.map((entry) => (
              <li key={entry.id} className="rounded-lg border p-4">
                <IncidentStatus status={entry.classification} />
                <p>
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
      {dialogOpen && id && (
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
              {INCIDENT_TYPE_LABELS[incident.type]} ·{' '}
              {new Date(incident.occurredAtDevice).toLocaleString('es-AR')}
            </DialogDescription>
            <img
              src={photoUrl}
              alt={`${INCIDENT_TYPE_LABELS[incident.type]} a las ${new Date(incident.occurredAtDevice).toLocaleString('es-AR')}`}
              className="max-h-[70vh] w-full object-contain"
            />
          </DialogContent>
        </Dialog>
      )}
    </main>
  );
}
