import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { reportDetailResponseSchema } from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Panel } from './panel';
import { StatusBadge } from '@/components/status-badge';

export function ReportDetail({
  query,
  page,
  onPage,
  timezone,
  onClose,
}: {
  query: string;
  page: number;
  onPage: (page: number) => void;
  timezone: string;
  onClose: () => void;
}) {
  const result = useQuery({
    queryKey: ['reports', 'detail', query, page],
    queryFn: () =>
      apiGet(`/reportes/rondas/detalle?${query}&page=${page}`, reportDetailResponseSchema),
  });
  return (
    <Panel
      title="Ventanas del segmento"
      bodyClassName="max-h-96 space-y-3 p-4"
      actions={
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      {result.isPending && <p role="status">Cargando detalle…</p>}
      {result.isError && (
        <Alert role="alert">
          No pudimos cargar el detalle.{' '}
          <Button variant="outline" onClick={() => void result.refetch()}>
            Reintentar
          </Button>
        </Alert>
      )}
      {result.data && (
        <>
          <p aria-live="polite">{result.data.total} ventanas</p>
          <ul className="space-y-3">
            {result.data.items.map((item) => (
              <li key={item.id} className="space-y-1 border-b border-border pb-3">
                <p className="font-semibold">
                  {item.roundName} · {item.site.name} · {item.guard?.name ?? 'Sin vigilador'}
                  {item.guard?.deactivated ? ' (desactivado)' : ''}
                </p>
                <p className="text-sm text-muted-foreground">
                  {new Date(item.startsAt).toLocaleString('es-AR', {
                    timeZone: timezone,
                    hourCycle: 'h23',
                  })}{' '}
                  –{' '}
                  {new Date(item.endsAt).toLocaleString('es-AR', {
                    timeZone: timezone,
                    hourCycle: 'h23',
                  })}
                </p>
                <StatusBadge
                  tone={
                    item.status === 'complete' || item.status === 'complete_late'
                      ? 'success'
                      : 'warning'
                  }
                >
                  {stateLabels[item.status] ?? item.status}
                </StatusBadge>{' '}
                <Link className="underline" to={`/supervision/turnos/${item.shiftId}`}>
                  Ver turno
                </Link>
              </li>
            ))}
          </ul>
          {result.data.total === 0 && <p>Este segmento no tiene ventanas.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => {
                onPage(page - 1);
              }}
            >
              Anterior
            </Button>
            <span>
              Página {page} de {Math.max(1, Math.ceil(result.data.total / result.data.pageSize))}
            </span>
            <Button
              variant="outline"
              disabled={page * result.data.pageSize >= result.data.total}
              onClick={() => {
                onPage(page + 1);
              }}
            >
              Siguiente
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}
const stateLabels: Record<string, string> = {
  complete: 'Completa',
  complete_late: 'Completa con demora',
  incomplete: 'Incompleta',
  not_done: 'No realizada',
  in_review: 'En revisión',
  pending_sync: 'Pendiente de sincronizar',
};
