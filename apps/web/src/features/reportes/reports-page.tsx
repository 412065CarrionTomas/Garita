import { useState, type SyntheticEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportQuerySchema, reportResponseSchema, type ReportQuery } from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ComplianceChart } from './charts/compliance-chart';
import { ReportDetail } from './report-detail';
import { ReportPending } from './report-pending';

export function ReportsPage() {
  const [filters, setFilters] = useState<ReportQuery>({});
  const [error, setError] = useState('');
  const [segment, setSegment] = useState<Record<string, string> | null>(null);
  const [page, setPage] = useState(1);
  const query = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString();
  const report = useQuery({
    queryKey: ['reports', 'rounds', query],
    queryFn: () => apiGet(`/reportes/rondas?${query}`, reportResponseSchema),
    refetchOnWindowFocus: 'always',
  });
  const data = report.data;
  const select = (value: Record<string, string>) => {
    setSegment(value);
    setPage(1);
  };
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(
      [...new FormData(event.currentTarget)].filter(([, value]) => value !== ''),
    );
    const result = reportQuerySchema.safeParse(values);
    if (!result.success) {
      setError('Ingresá un período válido, con inicio anterior al fin y de hasta 12 meses.');
      return;
    }
    setError('');
    setFilters(result.data);
    setSegment(null);
    setPage(1);
    const nextQuery = new URLSearchParams(
      Object.entries(result.data).filter((entry): entry is [string, string] => Boolean(entry[1])),
    ).toString();
    if (query === nextQuery) void report.refetch();
  };
  const period = data
    ? new URLSearchParams({ desde: data.desde, hasta: data.hasta }).toString()
    : '';
  const detailQuery = new URLSearchParams({
    ...filters,
    ...(data ? { desde: data.desde, hasta: data.hasta } : {}),
    ...segment,
  }).toString();
  return (
    <section aria-labelledby="reports-title" className="space-y-6">
      <PageHeader
        id="reports-title"
        title="Cumplimiento"
        description="Evaluá las rondas y resolvé lo pendiente antes de que lo vea el cliente."
      />
      <Card>
        <CardContent className="py-4">
          <form
            key={`${data?.desde}-${data?.hasta}`}
            onSubmit={submit}
            className="space-y-4"
            aria-label="Filtros de cumplimiento"
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="report-from">Desde</Label>
                <Input
                  id="report-from"
                  name="desde"
                  type="date"
                  required
                  defaultValue={filters.desde ?? data?.desde}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="report-to">Hasta (sin incluir)</Label>
                <Input
                  id="report-to"
                  name="hasta"
                  type="date"
                  required
                  defaultValue={filters.hasta ?? data?.hasta}
                />
              </div>
              {(['predio', 'cliente', 'vigilador'] as const).map((key) => (
                <div className="space-y-2" key={key}>
                  <Label htmlFor={`report-${key}`}>
                    {key === 'predio' ? 'Predio' : key === 'cliente' ? 'Cliente' : 'Vigilador'}
                  </Label>
                  <NativeSelect id={`report-${key}`} name={key} defaultValue={filters[key] ?? ''}>
                    <NativeSelectOption value="">Todos</NativeSelectOption>
                    {(key === 'predio'
                      ? data?.filters.sites
                      : key === 'cliente'
                        ? data?.filters.clients
                        : data?.filters.guards
                    )?.map((item) => (
                      <NativeSelectOption key={item.id} value={item.id}>
                        {item.name}
                      </NativeSelectOption>
                    ))}
                    {key === 'vigilador' && (
                      <NativeSelectOption value="unassigned">Sin vigilador</NativeSelectOption>
                    )}
                  </NativeSelect>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Fechas en la zona horaria de la empresa{data ? `: ${data.timezone}` : ''}. Por
              defecto, último mes hasta el inicio de hoy.
            </p>
            {error && <Alert role="alert">{error}</Alert>}
            <Button type="submit" disabled={report.isFetching}>
              Consultar cumplimiento
            </Button>
          </form>
        </CardContent>
      </Card>
      {report.isPending && <p role="status">Cargando cumplimiento…</p>}
      {report.isError && (
        <Alert role="alert">
          No pudimos cargar el cumplimiento. Revisá los filtros o intentá de nuevo.{' '}
          <Button variant="outline" onClick={() => void report.refetch()}>
            Reintentar
          </Button>
        </Alert>
      )}
      {data && (
        <>
          <Alert role="status">
            {data.totals.in_review} rondas en revisión: el cliente las ve como en verificación
          </Alert>
          <p>
            {data.totals.complete} completas de {data.totals.evaluated} evaluadas.{' '}
            {data.totals.pending_sync} pendientes de sincronizar, fuera del porcentaje.
          </p>
          <p className="text-sm text-muted-foreground">
            Completas: {data.totals.withoutObservations} sin observaciones; {data.totals.media} con
            observaciones medias; {data.totals.leve} leves; {data.totals.validated} validadas;{' '}
            {data.totals.complete_late} con demora.
          </p>
          <ComplianceChart
            title="Porcentaje de cumplimiento"
            percentage
            rows={[
              { id: 'total', name: 'Cumplimiento del período', value: data.totals.percentage },
            ]}
          />
          <ComplianceChart
            title="Rondas por estado"
            rows={[
              {
                id: 'complete',
                name: 'Completas sin demora',
                value: data.totals.complete - data.totals.complete_late,
              },
              {
                id: 'complete_late',
                name: 'Completas con demora',
                value: data.totals.complete_late,
              },
              { id: 'incomplete', name: 'Incompletas', value: data.totals.incomplete },
              { id: 'not_done', name: 'No realizadas', value: data.totals.not_done },
              {
                id: 'in_review',
                name: 'En revisión (fuera del porcentaje)',
                value: data.totals.in_review,
              },
              {
                id: 'pending_sync',
                name: 'Pendientes de sincronizar (fuera del porcentaje)',
                value: data.totals.pending_sync,
              },
            ]}
            onSelect={(estado) => {
              select({ estado });
            }}
          />
          <ComplianceChart
            title="Evolución diaria del cumplimiento"
            percentage
            evolution
            rows={data.daily.map((day) => ({
              id: day.id,
              name: day.name,
              value: day.totals.percentage,
            }))}
            onSelect={(dia) => {
              select({ dia });
            }}
          />
          <ComplianceChart
            title="Comparación de cumplimiento por predio"
            percentage
            rows={data.bySite.map((site) => ({
              id: site.id,
              name: site.name,
              value: site.totals.percentage,
            }))}
            onSelect={(predio) => {
              select({ predio });
            }}
          />
          <ComplianceChart
            title="Comparación de cumplimiento por vigilador"
            percentage
            rows={data.byGuard.map((guard) => ({
              id: guard.id ?? 'unassigned',
              name: `${guard.name}${guard.deactivated ? ' (desactivado)' : ''}`,
              value: guard.totals.percentage,
            }))}
            onSelect={(vigilador) => {
              select({ vigilador });
            }}
          />
          {segment && (
            <ReportDetail
              key={detailQuery}
              query={detailQuery}
              page={page}
              onPage={setPage}
              timezone={data.timezone}
            />
          )}
          <ReportPending period={period} predio={filters.predio} timezone={data.timezone} />
        </>
      )}
    </section>
  );
}
