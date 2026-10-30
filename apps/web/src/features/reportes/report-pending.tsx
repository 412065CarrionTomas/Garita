import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { reportPendingResponseSchema, reportPointsResponseSchema } from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function ReportPending({
  period,
  predio,
  timezone,
}: {
  period: string;
  predio?: string;
  timezone: string;
}) {
  const siteQuery = predio ? `predio=${encodeURIComponent(predio)}` : '';
  const pending = useQuery({
    queryKey: ['reports', 'pending', predio],
    queryFn: () => apiGet(`/reportes/pendientes?${siteQuery}`, reportPendingResponseSchema),
    refetchInterval: 30_000,
  });
  const points = useQuery({
    queryKey: ['reports', 'points', period, predio],
    queryFn: () =>
      apiGet(
        `/reportes/puntos-marcas-frecuentes?${period}&${siteQuery}`,
        reportPointsResponseSchema,
      ),
  });
  const date = (value: string | null) =>
    value
      ? new Date(value).toLocaleString('es-AR', { timeZone: timezone, hourCycle: 'h23' })
      : 'Sin pendientes';
  const age = (value: string | null) =>
    value
      ? `Más antiguo: ${date(value)} (hace ${Math.max(0, Math.floor((pending.dataUpdatedAt - Date.parse(value)) / 3600_000))} h)`
      : 'Sin pendientes';
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Pendientes del supervisor</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pendientes actuales del predio seleccionado, independientes del período, cliente y
            vigilador.
          </p>
          {pending.isPending && <p role="status">Cargando pendientes…</p>}
          {pending.isError && (
            <Alert role="alert">
              No pudimos cargar los pendientes.{' '}
              <Button variant="outline" onClick={() => void pending.refetch()}>
                Reintentar
              </Button>
            </Alert>
          )}
          {pending.data && (
            <>
              <p>{pending.data.message}</p>
              <ul className="space-y-3">
                <li>
                  <Link className="underline" to="/revision">
                    {pending.data.inReview.count} rondas en revisión
                  </Link>{' '}
                  · {age(pending.data.inReview.oldestAt)}
                </li>
                <li>
                  <Link className="underline" to="/incidentes/cola">
                    {pending.data.incidents.count} incidentes pendientes de clasificar
                  </Link>{' '}
                  · {age(pending.data.incidents.oldestAt)}
                </li>
                <li>
                  <Link className="underline" to="/avisos?tipo=shift_unsynced">
                    {pending.data.unsynced.count} turnos sin sincronizar
                  </Link>{' '}
                  · {age(pending.data.unsynced.oldestAt)}
                </li>
                <li>
                  <Link className="underline" to="/turnos">
                    {pending.data.unassigned.count} turnos futuros sin vigilador
                  </Link>{' '}
                  · Próximo: {date(pending.data.unassigned.nextAt)}
                </li>
              </ul>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Puntos con marcas frecuentes</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Del período y predio seleccionados; no se filtra por cliente ni vigilador. Solo
            registros válidos y al menos tres marcados.
          </p>
          {points.isPending && <p role="status">Cargando puntos…</p>}
          {points.isError && (
            <Alert role="alert">
              No pudimos cargar los puntos.{' '}
              <Button variant="outline" onClick={() => void points.refetch()}>
                Reintentar
              </Button>
            </Alert>
          )}
          {points.data?.items.length === 0 && <p>No hay puntos con marcas frecuentes.</p>}
          <ul className="space-y-3">
            {points.data?.items.map((point) => (
              <li key={point.id}>
                <p className="font-medium">
                  {point.name} · {point.site.name}
                </p>
                <p>
                  {point.markedRecords} de {point.validRecords} registros con marcas (
                  {(point.proportion * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}{' '}
                  %)
                </p>
                <p>
                  {point.distribution === 'concentrated'
                    ? 'Concentradas en un vigilador: posible problema de conducta'
                    : `Repartidas entre ${point.guardCount} vigiladores: probable problema del punto`}
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
