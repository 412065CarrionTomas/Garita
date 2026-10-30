import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { panicAlertDetailSchema } from '@garita/shared';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ClientSitesMap } from '@/features/mapa/site-location-map';
import { env } from '@/config/env';
import { apiGet, apiPost } from '@/lib/api-client';
import { panicOutcomes, panicStatuses } from './queries';
import { ResolvePanicDialog } from './resolve-dialog';

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
  if (detail.isPending) return <p role="status">Cargando alerta…</p>;
  if (detail.isError)
    return (
      <Alert variant="destructive">
        No se pudo cargar la alerta. Revisá tus permisos e intentá nuevamente.
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
      <PageHeader title="Alerta de pánico" description={alert.site.name} />
      <Link className="underline" to="/alertas-panico">
        Volver a alertas
      </Link>
      <StatusBadge
        tone={
          alert.status === 'active'
            ? 'danger'
            : alert.status === 'confirmed'
              ? 'warning'
              : 'success'
        }
      >
        {panicStatuses[alert.status]}
      </StatusBadge>
      {/* TODO(HU-37): SMS ingestion will provide authenticated=false for unverified alerts. */}
      {alert.channel === 'sms' && !alert.authenticated && (
        <Alert>No verificada. Atendé la alerta igualmente.</Alert>
      )}
      {delayed && (
        <Alert>
          Enviada por {alert.channel === 'sms' ? 'SMS' : 'internet'} a las{' '}
          {localTime(alert.triggeredAt)}, recibida por la plataforma a las{' '}
          {localTime(alert.receivedAt)}
        </Alert>
      )}
      <Card>
        <CardContent className="space-y-4 py-4">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">Vigilador</dt>
              <dd>{alert.guard.name}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Teléfono</dt>
              <dd>
                {alert.guard.phone ? (
                  <a className="underline" href={`tel:${alert.guard.phone}`}>
                    Llamar al vigilador: {alert.guard.phone}
                  </a>
                ) : (
                  'Sin teléfono registrado'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Canal de origen</dt>
              <dd>{alert.channel === 'sms' ? 'SMS' : 'Internet'}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Enviada</dt>
              <dd className="tabular-nums">{timestamp(alert.triggeredAt)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Recibida por la plataforma</dt>
              <dd className="tabular-nums">{timestamp(alert.receivedAt)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Escalada</dt>
              <dd>{alert.escalatedAt ? `Sí · ${timestamp(alert.escalatedAt)}` : 'No'}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Confirmación</dt>
              <dd>
                {alert.confirmedAt
                  ? `${alert.confirmedBy?.name ?? 'Usuario'} · ${timestamp(alert.confirmedAt)}`
                  : 'Pendiente'}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Resolución</dt>
              <dd>
                {alert.resolvedAt
                  ? `${alert.resolvedBy?.name ?? 'Usuario'} · ${timestamp(alert.resolvedAt)}`
                  : 'Pendiente'}
              </dd>
            </div>
            {alert.outcome && (
              <div>
                <dt className="text-sm text-muted-foreground">Resultado</dt>
                <dd>{panicOutcomes[alert.outcome]}</dd>
              </div>
            )}
            {alert.resolutionComment && (
              <div>
                <dt className="text-sm text-muted-foreground">Comentario</dt>
                <dd className="whitespace-pre-wrap break-words">{alert.resolutionComment}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>
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
        <h2 className="text-lg font-semibold">Ubicación</h2>
        {alert.latitude === null || alert.longitude === null ? (
          <p>No se registró ubicación.</p>
        ) : (
          <>
            <p>
              Coordenadas: {alert.latitude}, {alert.longitude}
              {alert.accuracyMeters !== null ? ` · Precisión: ${alert.accuracyMeters} m` : ''}
            </p>
            {env.VITE_GOOGLE_MAPS_API_KEY ? (
              <ClientSitesMap
                sites={[
                  {
                    id: alert.id,
                    name: 'Ubicación de la alerta',
                    latitude: alert.latitude,
                    longitude: alert.longitude,
                  },
                ]}
              />
            ) : (
              <p>El mapa no está configurado; consultá las coordenadas.</p>
            )}
          </>
        )}
      </section>
      <section aria-label="SMS a destinatarios" className="space-y-3">
        <h2 className="text-lg font-semibold">SMS a destinatarios</h2>
        {alert.smsDeliveries.length ? (
          <ul>
            {alert.smsDeliveries.map((delivery) => (
              <li key={delivery.id}>
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
