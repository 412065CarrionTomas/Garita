import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { panicAlertDetailSchema } from '@garita/shared';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SitesMap } from '@/features/mapa/sites-map';
import { apiGet, apiPost } from '@/lib/api-client';
import { panicOutcomes, panicStatuses } from './queries';
import { ResolvePanicDialog } from './resolve-dialog';
import { SmsBadges } from './sms-badges';

export function PanicDetailPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const [resolveOpen, setResolveOpen] = useState(false);
  const detail = useQuery({
    queryKey: ['panico', 'detail', id],
    queryFn: () => apiGet(`/alertas-panico/${id}`, panicAlertDetailSchema),
    enabled: !!id,
    refetchInterval: 15000,
  });
  const confirm = useMutation({
    mutationFn: () =>
      apiPost(`/alertas-panico/${id}/confirmar`, {}, z.object({}), panicAlertDetailSchema),
    onSettled: () => client.invalidateQueries({ queryKey: ['panico'] }),
  });
  if (detail.isPending)
    return (
      <div role="status" className="space-y-2">
        <span className="sr-only">Cargando alerta…</span>
        {[0].map((i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );
  if (detail.isError)
    return (
      <Alert variant="destructive">
        No se pudo cargar la alerta. Revisá tus permisos e intentá nuevamente.{' '}
        <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
          Reintentar
        </Button>
      </Alert>
    );
  const alert = detail.data;
  const localTime = (date: string) =>
    new Intl.DateTimeFormat('es-AR', {
      timeZone: alert.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(date));
  const timestamp = (date: string) =>
    new Date(date).toLocaleString('es-AR', { timeZone: alert.timezone });
  const delayed = Date.parse(alert.receivedAt) - Date.parse(alert.triggeredAt) > 60000;
  const smsStatus = {
    accepted: 'Aceptado por el proveedor',
    failed: 'Fallido',
    skipped: 'Omitido (sin envío)',
  };
  return (
    <section className="space-y-6" aria-label="Detalle de alerta de pánico">
      <PageHeader
        title="Alerta de pánico"
        description={alert.site.name}
        actions={
          <Button asChild variant="outline">
            <Link to="/alertas-panico">Volver a alertas</Link>
          </Button>
        }
      />
      <StatusBadge
        tone={
          alert.status === 'active' ? 'danger' : alert.status === 'confirmed' ? 'info' : 'success'
        }
      >
        {panicStatuses[alert.status]}
      </StatusBadge>
      <SmsBadges {...alert} />
      {alert.channel === 'sms' && !alert.authenticated && (
        <Alert variant="destructive">No verificada. Atendé la alerta igualmente.</Alert>
      )}
      {delayed && (
        <Alert variant="neutral">
          Enviada por {alert.channel === 'sms' ? 'SMS' : 'internet'} a las{' '}
          {localTime(alert.triggeredAt)}, recibida por la plataforma a las{' '}
          {localTime(alert.receivedAt)}
        </Alert>
      )}
      <div className="border-[1.5px] border-input p-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="t-label text-muted-foreground">Vigilador</dt>
            <dd>{alert.guard.name}</dd>
          </div>
          <div>
            <dt className="t-label text-muted-foreground">Teléfono</dt>
            <dd>
              {alert.guard.phone ? (
                <a
                  className="font-semibold underline underline-offset-4"
                  href={`tel:${alert.guard.phone}`}
                >
                  Llamar al vigilador: {alert.guard.phone}
                </a>
              ) : (
                'Sin teléfono registrado'
              )}
            </dd>
          </div>
          <div>
            <dt className="t-label text-muted-foreground">Canal de origen</dt>
            <dd>{alert.channel === 'sms' ? 'SMS' : 'Internet'}</dd>
          </div>
          <div>
            <dt className="t-label text-muted-foreground">Enviada</dt>
            <dd className="tabular-nums">{timestamp(alert.triggeredAt)}</dd>
          </div>
          <div>
            <dt className="t-label text-muted-foreground">Recibida por la plataforma</dt>
            <dd className="tabular-nums">{timestamp(alert.receivedAt)}</dd>
          </div>
          <div>
            <dt className="t-label text-muted-foreground">Escalada</dt>
            <dd>{alert.escalatedAt ? `Sí · ${timestamp(alert.escalatedAt)}` : 'No'}</dd>
          </div>
          <div>
            <dt className="t-label text-muted-foreground">Confirmación</dt>
            <dd>
              {alert.confirmedAt
                ? `${alert.confirmedBy?.name ?? 'Usuario'} · ${timestamp(alert.confirmedAt)}`
                : 'Pendiente'}
            </dd>
          </div>
          <div>
            <dt className="t-label text-muted-foreground">Resolución</dt>
            <dd>
              {alert.resolvedAt
                ? `${alert.resolvedBy?.name ?? 'Usuario'} · ${timestamp(alert.resolvedAt)}`
                : 'Pendiente'}
            </dd>
          </div>
          {alert.outcome && (
            <div>
              <dt className="t-label text-muted-foreground">Resultado</dt>
              <dd>{panicOutcomes[alert.outcome]}</dd>
            </div>
          )}
          {alert.resolutionComment && (
            <div>
              <dt className="t-label text-muted-foreground">Comentario</dt>
              <dd className="whitespace-pre-wrap break-words">{alert.resolutionComment}</dd>
            </div>
          )}
        </dl>
      </div>
      {confirm.isError && (
        <Alert variant="destructive">
          No se pudo confirmar. Revisá si alguien ya atendió la alerta.
        </Alert>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={alert.status !== 'active' || confirm.isPending}
          onClick={() => {
            confirm.mutate();
          }}
        >
          Confirmar alerta
        </Button>
        <Button
          variant="outline"
          disabled={alert.status !== 'confirmed'}
          aria-describedby="panic-resolve-help"
          onClick={() => {
            setResolveOpen(true);
          }}
        >
          Resolver alerta
        </Button>
      </div>
      <p id="panic-resolve-help" className="text-sm text-muted-foreground">
        {alert.status === 'active'
          ? 'Primero confirmá la alerta para poder resolverla.'
          : alert.status === 'resolved'
            ? 'La alerta ya fue resuelta.'
            : 'Podés resolverla aunque la haya confirmado otra persona.'}
      </p>
      <section aria-label="Ubicación de la alerta" className="space-y-3">
        <h2 className="t-label text-muted-foreground">Ubicación</h2>
        {alert.latitude === null || alert.longitude === null ? (
          <p>No se registró ubicación.</p>
        ) : (
          <>
            <p>
              Coordenadas: {alert.latitude}, {alert.longitude}
              {alert.accuracyMeters !== null ? ` · Precisión: ${alert.accuracyMeters} m` : ''}
            </p>
            <SitesMap
              sites={[
                {
                  id: alert.id,
                  name: 'Ubicación de la alerta',
                  latitude: alert.latitude,
                  longitude: alert.longitude,
                },
              ]}
            />
          </>
        )}
      </section>
      <section aria-label="SMS a destinatarios" className="space-y-3">
        <h2 className="t-label text-muted-foreground">SMS a destinatarios</h2>
        {alert.smsDeliveries.length ? (
          <ul className="divide-y divide-border border-[1.5px] border-input">
            {alert.smsDeliveries.map((delivery) => (
              <li key={delivery.id} className="px-3 py-2 tabular-nums">
                {delivery.reason === 'initial' ? 'Inicial' : 'Escalamiento'} ·{' '}
                {smsStatus[delivery.status]} · {timestamp(delivery.createdAt)}
              </li>
            ))}
          </ul>
        ) : (
          <p>Sin envíos registrados todavía.</p>
        )}
      </section>
      {resolveOpen && id && alert.status === 'confirmed' && (
        <ResolvePanicDialog
          id={id}
          onClose={() => {
            setResolveOpen(false);
          }}
        />
      )}
    </section>
  );
}
