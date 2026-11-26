import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { reportDetailResponseSchema } from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { EmptyState } from '@/components/empty-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Panel } from './panel';
import { DataTable } from '@/components/data-table';

const SHOWN = 8;

/** Las ventanas no realizadas más recientes del período, siempre visibles debajo de la vista elegida. */
export function NotDoneList({ query, timezone }: { query: string; timezone: string }) {
  const result = useQuery({
    queryKey: ['reports', 'not-done', query],
    queryFn: () =>
      apiGet(
        `/reportes/rondas/detalle?${query}&estado=not_done&pageSize=${SHOWN}&orden=desc`,
        reportDetailResponseSchema,
      ),
  });
  const items = [...(result.data?.items ?? [])]
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
    .slice(0, SHOWN);
  const hour = (value: string) =>
    new Date(value).toLocaleTimeString('es-AR', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  return (
    <Panel
      title={
        <>
          No realizadas
          {result.data && result.data.total > 0 && (
            <span className="ml-2 font-sans text-sm font-normal tracking-normal normal-case text-muted-foreground">
              {items.length < result.data.total
                ? `las ${items.length} más recientes de ${result.data.total}`
                : `${result.data.total} en el período`}
            </span>
          )}
        </>
      }
      bodyClassName="max-h-80"
    >
      {result.isPending && (
        <div role="status" aria-label="Cargando no realizadas" className="space-y-2 p-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
      {result.isError && (
        <Alert variant="destructive" className="m-4">
          No pudimos cargar las ventanas no realizadas.{' '}
          <Button variant="outline" size="sm" onClick={() => void result.refetch()}>
            Reintentar
          </Button>
        </Alert>
      )}
      {result.data && items.length === 0 && (
        <EmptyState
          title="Sin ventanas no realizadas"
          description="En este período se cumplieron todas."
        />
      )}
      {items.length > 0 && (
        <DataTable
          label="No realizadas"
          rows={items}
          getRowId={(item) => item.id}
          columns={[
            {
              id: 'date',
              header: 'Fecha',
              type: 'date',
              width: 96,
              value: (item) => item.startsAt,
              cell: (item) =>
                new Date(item.startsAt).toLocaleDateString('es-AR', {
                  timeZone: timezone,
                  day: '2-digit',
                  month: '2-digit',
                }),
              className: 'tabular-nums',
            },
            {
              id: 'window',
              header: 'Ventana',
              type: 'date',
              width: 128,
              value: (item) => item.startsAt,
              cell: (item) => `${hour(item.startsAt)}–${hour(item.endsAt)}`,
              className: 'tabular-nums',
            },
            {
              id: 'site',
              header: 'Predio',
              value: (item) => item.site.name,
              className: 'font-semibold',
            },
            {
              id: 'guard',
              header: 'Vigilador',
              value: (item) =>
                item.guard
                  ? `${item.guard.name}${item.guard.deactivated ? ' (desactivado)' : ''}`
                  : 'Sin vigilador',
              cell: (item) =>
                item.guard ? (
                  `${item.guard.name}${item.guard.deactivated ? ' (desactivado)' : ''}`
                ) : (
                  <span className="text-danger">Sin vigilador</span>
                ),
            },
            {
              id: 'detail',
              header: 'Detalle',
              hideHeader: true,
              width: 112,
              align: 'right',
              // TODO(foja): falta el motivo ("Sin señal: sin registros" / "Sin explicación"); la API no lo trae.
              cell: (item) => (
                <Link
                  className="font-semibold underline-offset-4 hover:underline"
                  to={`/supervision/turnos/${item.shiftId}`}
                  aria-label={`Ver foja: ${item.site.name} ${hour(item.startsAt)}`}
                >
                  Ver foja →
                </Link>
              ),
            },
          ]}
        />
      )}
    </Panel>
  );
}
