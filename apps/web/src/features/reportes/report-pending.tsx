import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  reportPendingResponseSchema,
  reportPointsResponseSchema,
  responseTimesReportSchema,
} from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { minutes } from './incidentes/format';
import { Panel } from './panel';

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
  // Rondas incumplidas: cuánto tarda un supervisor en ver el aviso (los incidentes van en su reporte).
  const times = useQuery({
    queryKey: ['reports', 'response-times', period, predio],
    queryFn: () =>
      apiGet(`/reportes/tiempos-de-respuesta?${period}&${siteQuery}`, responseTimesReportSchema),
  });
  const missed = times.data?.totals.missedRound;
  const date = (value: string | null) =>
    value
      ? new Date(value).toLocaleString('es-AR', { timeZone: timezone, hourCycle: 'h23' })
      : 'Sin pendientes';
  const age = (value: string | null) =>
    value
      ? `Más antiguo: ${date(value)} (hace ${Math.max(0, Math.floor((pending.dataUpdatedAt - Date.parse(value)) / 3600_000))} h)`
      : 'Sin pendientes';
  const rows = pending.data
    ? [
        {
          to: '/revision',
          count: pending.data.inReview.count,
          label: 'rondas en revisión',
          meta: age(pending.data.inReview.oldestAt),
        },
        ...(missed
          ? [
              {
                to: '/avisos?tipo=round_missed',
                count: missed.unanswered,
                label: 'avisos de ronda incumplida sin ver en el período',
                meta: `Tiempo hasta verlos: promedio ${minutes(missed.averageMs)}, máximo ${minutes(missed.maximumMs)}`,
              },
            ]
          : []),
        {
          to: '/avisos?tipo=shift_unsynced',
          count: pending.data.unsynced.count,
          label: 'turnos sin sincronizar',
          meta: age(pending.data.unsynced.oldestAt),
        },
        {
          to: '/turnos',
          count: pending.data.unassigned.count,
          label: 'turnos futuros sin vigilador',
          meta: `Próximo: ${date(pending.data.unassigned.nextAt)}`,
        },
      ]
    : [];
  return (
    <>
      <Panel title="Pendientes del supervisor" className="shrink-0">
        <p className="px-4 pt-3 text-muted-foreground">
          Actuales del predio elegido, salvo los avisos de ronda incumplida, que son del período.
        </p>
        {times.isError && (
          <Alert role="alert" className="m-4">
            No pudimos cargar el tiempo de respuesta a rondas incumplidas.{' '}
            <Button variant="outline" onClick={() => void times.refetch()}>
              Reintentar
            </Button>
          </Alert>
        )}
        {pending.isPending && (
          <p role="status" className="p-4">
            Cargando pendientes…
          </p>
        )}
        {pending.isError && (
          <Alert role="alert" className="m-4">
            No pudimos cargar los pendientes.{' '}
            <Button variant="outline" onClick={() => void pending.refetch()}>
              Reintentar
            </Button>
          </Alert>
        )}
        {pending.data && (
          <>
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.to} className="px-4 py-2.5">
                  <Link className="group flex items-baseline gap-3 font-semibold" to={row.to}>
                    <span
                      className={cn(
                        't-numeral w-9 shrink-0 text-right text-2xl',
                        row.count === 0 && 'text-muted-foreground',
                      )}
                    >
                      {row.count}
                    </span>{' '}
                    <span className="underline-offset-4 group-hover:underline">{row.label}</span>
                  </Link>
                  <span className="block pl-12 text-muted-foreground">{row.meta}</span>
                </li>
              ))}
            </ul>
            <p className="border-t border-border px-4 py-2.5 text-muted-foreground">
              {pending.data.message}.
            </p>
          </>
        )}
      </Panel>
      <Panel title="Puntos con marcas frecuentes" bodyClassName="max-h-160">
        <p className="px-4 pt-3 text-muted-foreground">
          Del período y predio elegidos, sin filtrar por cliente ni vigilador. Solo registros
          válidos y al menos tres marcados.
        </p>
        {points.isPending && (
          <p role="status" className="p-4">
            Cargando puntos…
          </p>
        )}
        {points.isError && (
          <Alert role="alert" className="m-4">
            No pudimos cargar los puntos.{' '}
            <Button variant="outline" onClick={() => void points.refetch()}>
              Reintentar
            </Button>
          </Alert>
        )}
        {points.data?.items.length === 0 && (
          <p className="p-4">No hay puntos con marcas frecuentes.</p>
        )}
        <ul className="divide-y divide-border">
          {points.data?.items.map((point) => {
            const percent = point.proportion * 100;
            const concentrated = point.distribution === 'concentrated';
            return (
              <li key={point.id} className="space-y-1.5 px-4 py-3">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="font-semibold">{point.name}</span>
                    <span className="block text-muted-foreground">{point.site.name}</span>
                  </span>
                  <span className="t-numeral shrink-0">
                    {percent.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %
                  </span>
                </p>
                <span aria-hidden="true" className="block h-1.5 bg-muted">
                  <span
                    className={cn('block h-full', concentrated ? 'bg-warning' : 'bg-foreground')}
                    style={{ width: `${Math.min(100, percent)}%` }}
                  />
                </span>
                <p className="text-muted-foreground">
                  {point.markedRecords} de {point.validRecords} registros con marcas ·{' '}
                  <span className={cn(concentrated && 'font-semibold text-warning')}>
                    {concentrated
                      ? 'Concentradas en un vigilador: posible problema de conducta'
                      : `Repartidas entre ${point.guardCount} vigiladores: probable problema del punto`}
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      </Panel>
    </>
  );
}
