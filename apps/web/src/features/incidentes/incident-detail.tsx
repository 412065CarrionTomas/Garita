/* eslint react-refresh/only-export-components: off */
import {
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_TYPE_LABELS,
  incidentDetailSchema,
  incidentFollowUpActionInputSchema,
  type IncidentDetail as Detail,
  type IncidentTimelineEntry,
} from '@garita/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SitesMap } from '@/features/mapa/sites-map';
import { apiGet, apiPost } from '@/lib/api-client';
import { DecisionForm } from './decision-form';
import {
  ClassificationBadge,
  FollowUpBadge,
  RowsSkeleton,
  SeverityBadge,
  fullDateTime,
  shortDateTime,
} from './incident-ui';
import { PhotoGallery } from './photo-gallery';

export function useIncidentDetail(id: string) {
  return useQuery({
    queryKey: ['incidents', 'detail', id],
    queryFn: () => apiGet(`/incidentes/${id}`, incidentDetailSchema),
  });
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{children}</dd>
    </div>
  );
}

const TIMELINE_TITLE: Record<Exclude<IncidentTimelineEntry['kind'], 'classification'>, string> = {
  note: 'Acción de seguimiento',
  close: 'Seguimiento cerrado',
  reopen: 'Seguimiento reabierto',
};

function Timeline({ entries, timeZone }: { entries: IncidentTimelineEntry[]; timeZone: string }) {
  if (!entries.length)
    return <p className="text-muted-foreground">Todavía no hay decisiones ni acciones.</p>;
  return (
    <ol className="space-y-0 border-l-[1.5px] border-input">
      {entries.map((entry) => (
        <li key={entry.id} className="relative space-y-1 pb-5 pl-5 last:pb-0">
          <span
            aria-hidden="true"
            className="absolute top-1.5 -left-[5px] size-2.5 rounded-full bg-foreground"
          />
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">
              {entry.kind === 'classification'
                ? entry.reason
                  ? 'Reclasificado'
                  : 'Clasificado'
                : TIMELINE_TITLE[entry.kind]}
            </span>
            {entry.kind === 'classification' && (
              <>
                <ClassificationBadge status={entry.classification} />
                {entry.severity && (
                  <span className="text-sm">
                    Gravedad {INCIDENT_SEVERITY_LABELS[entry.severity].toLowerCase()}
                  </span>
                )}
              </>
            )}
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {entry.author} · {fullDateTime(entry.at, timeZone)}
          </p>
          {entry.kind === 'classification' ? (
            <div className="space-y-0.5">
              <p>{entry.internalComment}</p>
              {entry.clientNote && (
                <p>
                  <span className="text-muted-foreground">Nota al cliente:</span> {entry.clientNote}
                </p>
              )}
              {entry.reason && (
                <p>
                  <span className="text-muted-foreground">Motivo:</span> {entry.reason}
                </p>
              )}
            </div>
          ) : (
            <p>{entry.text}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

const followUpResponse = z.object({ followUpStatus: z.string() });

function FollowUpActions({ incident }: { incident: Detail }) {
  const client = useQueryClient();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (kind: 'acciones' | 'cerrar' | 'reabrir') =>
      apiPost(
        `/incidentes/${incident.id}/seguimiento/${kind}`,
        { text },
        incidentFollowUpActionInputSchema,
        followUpResponse,
      ),
    onSuccess: async () => {
      setText('');
      await client.invalidateQueries({ queryKey: ['incidents'] });
    },
  });
  const run = (kind: 'acciones' | 'cerrar' | 'reabrir') => {
    const parsed = incidentFollowUpActionInputSchema.safeParse({ text });
    if (!parsed.success) {
      setError('Escribí al menos 3 caracteres.');
      return;
    }
    setError(null);
    mutation.mutate(kind);
  };
  if (incident.followUpStatus === 'none') return null;
  const open = incident.followUpStatus === 'open';
  return (
    <div className="space-y-2 border-[1.5px] border-input p-4">
      <Label htmlFor="follow-up-text">
        {open ? 'Registrar acción o cierre' : 'Motivo para reabrir'}
      </Label>
      <Textarea
        id="follow-up-text"
        rows={2}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        aria-invalid={!!error}
        aria-describedby={error ? 'follow-up-error' : undefined}
      />
      {error && (
        <p id="follow-up-error" className="text-sm text-danger">
          {error}
        </p>
      )}
      {mutation.isError && <Alert variant="destructive">No se pudo guardar el seguimiento.</Alert>}
      <div className="flex flex-wrap gap-2">
        {open ? (
          <>
            <Button
              disabled={mutation.isPending}
              onClick={() => {
                run('acciones');
              }}
            >
              Agregar acción
            </Button>
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => {
                run('cerrar');
              }}
            >
              Cerrar seguimiento
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => {
              run('reabrir');
            }}
          >
            Reabrir seguimiento
          </Button>
        )}
      </div>
    </div>
  );
}

/** Cuerpo del detalle: descripción y fotos a la izquierda; mapa y contexto a la derecha. */
export function IncidentBody({
  incident,
  compact = false,
}: {
  incident: Detail;
  compact?: boolean;
}) {
  const tz = incident.timezone;
  const caption = `${INCIDENT_TYPE_LABELS[incident.type]} · ${fullDateTime(incident.occurredAt, tz)}`;
  const { shiftContext: shift } = incident;
  return (
    <div
      className={
        compact
          ? 'grid gap-6 2xl:grid-cols-[3fr_2fr]'
          : 'grid gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'
      }
    >
      <div className="min-w-0 space-y-6">
        <Section title="Qué reportó el vigilador">
          <p className="text-base leading-relaxed">
            {incident.description ?? (
              <span className="text-muted-foreground">Sin descripción.</span>
            )}
          </p>
        </Section>
        <Section title={`Fotos (${String(incident.photos.length)})`}>
          <PhotoGallery photos={incident.photos} caption={caption} />
        </Section>
      </div>
      <div className="min-w-0 space-y-6">
        <Section title="Ubicación">
          {incident.location ? (
            <>
              <div className="overflow-hidden border-[1.5px] border-input">
                <SitesMap
                  height={compact ? 220 : 300}
                  sites={[
                    {
                      id: incident.id,
                      name: 'Ubicación del incidente',
                      latitude: incident.location.latitude,
                      longitude: incident.location.longitude,
                    },
                  ]}
                />
              </div>
              <p className="text-sm text-muted-foreground tabular-nums">
                {incident.location.latitude.toFixed(6)}, {incident.location.longitude.toFixed(6)}
                {incident.location.accuracyMeters !== null &&
                  ` · precisión ±${String(Math.round(incident.location.accuracyMeters))} m`}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">El celular no registró la ubicación.</p>
          )}
        </Section>
        <Section title="Contexto del turno">
          <dl>
            <Fact label="Turno">
              {shortDateTime(shift.startsAt, tz)} – {shortDateTime(shift.endsAt, tz)}
            </Fact>
            <Fact label="Ronda">{shift.roundName ?? 'Sin ronda asignada'}</Fact>
            <Fact label="Último punto marcado">
              {shift.lastCheckpoint
                ? `${shift.lastCheckpoint.name} · ${shortDateTime(shift.lastCheckpoint.at, tz)}`
                : 'Ninguno antes del incidente'}
            </Fact>
            <Fact label="Recibido en el sistema">{shortDateTime(incident.receivedAt, tz)}</Fact>
          </dl>
        </Section>
        <Section title="Otros incidentes en el predio (30 días)">
          {incident.relatedIncidents.length ? (
            <ul className="space-y-1">
              {incident.relatedIncidents.map((related) => (
                <li key={related.id}>
                  <Link
                    to={`/incidentes/${related.id}`}
                    className="flex justify-between gap-3 underline-offset-4 hover:underline"
                  >
                    <span>{INCIDENT_TYPE_LABELS[related.type]}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {shortDateTime(related.occurredAt, tz)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">Es el único del último mes.</p>
          )}
        </Section>
      </div>
    </div>
  );
}

export function IncidentDetailPage() {
  const { id } = useParams();
  return id ? <IncidentDetailView key={id} id={id} /> : null;
}

function IncidentDetailView({ id }: { id: string }) {
  const [deciding, setDeciding] = useState(false);
  const detail = useIncidentDetail(id);
  if (detail.isPending) return <RowsSkeleton label="Cargando incidente…" />;
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
  const pending = incident.classificationStatus === 'pending';
  return (
    <main className="space-y-6">
      <PageHeader
        title={INCIDENT_TYPE_LABELS[incident.type]}
        description={`${incident.site.name} · ${fullDateTime(incident.occurredAt, incident.timezone)} · ${incident.guardName}`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/incidentes">Volver a incidentes</Link>
            </Button>
            <Button
              onClick={() => {
                setDeciding(true);
              }}
            >
              {pending ? 'Clasificar' : 'Reclasificar'}
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2" aria-label="Estado del incidente">
        <ClassificationBadge status={incident.classificationStatus} />
        <SeverityBadge severity={incident.severity} />
        {incident.followUpStatus !== 'none' && <FollowUpBadge status={incident.followUpStatus} />}
      </div>
      <IncidentBody incident={incident} />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title="Bitácora">
          <Timeline entries={incident.timeline} timeZone={incident.timezone} />
        </Section>
        {incident.followUpStatus !== 'none' && (
          <Section title="Seguimiento">
            <FollowUpActions incident={incident} />
          </Section>
        )}
      </div>
      {deciding && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setDeciding(false);
          }}
        >
          <DialogContent className="sm:max-w-3xl">
            <DialogTitle>{pending ? 'Clasificar incidente' : 'Reclasificar incidente'}</DialogTitle>
            <DialogDescription>
              La decisión y su autor quedan registrados en la bitácora.
            </DialogDescription>
            <DecisionForm
              id={incident.id}
              reclassify={!pending}
              onDone={() => {
                setDeciding(false);
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </main>
  );
}
