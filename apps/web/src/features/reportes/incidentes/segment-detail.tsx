import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  incidentReportDetailResponseSchema,
  panicReportDetailResponseSchema,
  INCIDENT_TYPE_LABELS,
  type IncidentReportDetailData,
  type PanicReportDetailData,
} from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function SegmentDetail({
  kind,
  query,
  page,
  onPage,
  timezone,
}: {
  kind: 'incidentes' | 'panico';
  query: string;
  page: number;
  onPage: (page: number) => void;
  timezone: string;
}) {
  const result = useQuery<IncidentReportDetailData | PanicReportDetailData>({
    queryKey: ['reports', kind, 'detail', query, page],
    queryFn: () =>
      kind === 'incidentes'
        ? apiGet(
            `/reportes/incidentes/detalle?${query}&page=${page}`,
            incidentReportDetailResponseSchema,
          )
        : apiGet(`/reportes/panico/detalle?${query}&page=${page}`, panicReportDetailResponseSchema),
  });
  const date = (value: string) =>
    new Date(value).toLocaleString('es-AR', { timeZone: timezone, hourCycle: 'h23' });
  return (
    <section aria-labelledby="segment-title" className="space-y-3">
      <h2 id="segment-title" className="t-headline">
        Detalle del segmento
      </h2>
      {result.isPending && <p role="status">Cargando detalle…</p>}
      {result.isError && (
        <Alert role="alert">
          No pudimos cargar el detalle.{' '}
          <Button onClick={() => void result.refetch()}>Reintentar detalle</Button>
        </Alert>
      )}
      {result.data && (
        <>
          <p role="status">
            {result.data.total} registros · página {page}
          </p>
          <ul className="space-y-2">
            {result.data.items.map((item) => (
              <li key={item.id}>
                <Link
                  className="underline"
                  to={
                    'occurredAt' in item ? `/incidentes/${item.id}` : `/alertas-panico/${item.id}`
                  }
                >
                  {item.site.name} ·{' '}
                  {'occurredAt' in item
                    ? `${INCIDENT_TYPE_LABELS[item.type]} · ${date(item.occurredAt)}`
                    : `Alerta de pánico · ${date(item.triggeredAt)}`}
                </Link>
              </li>
            ))}
          </ul>
          {result.data.total === 0 && <p>No hay registros en este segmento.</p>}
          <div className="flex gap-3">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => {
                onPage(page - 1);
              }}
            >
              Anterior
            </Button>
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
    </section>
  );
}
