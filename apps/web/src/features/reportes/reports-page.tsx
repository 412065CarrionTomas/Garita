import { useState, type SyntheticEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  localReportDay,
  reportQuerySchema,
  reportResponseSchema,
  type ReportQuery,
} from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { SegmentedFilter } from '@/components/segmented-filter';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { ComplianceChart } from './charts/compliance-chart';
import { percentageTone } from './charts/compliance-tone';
import { SiteComplianceTable, WindowGrid } from './compliance-views';
import { NotDoneList } from './not-done-list';
import { ReportDetail } from './report-detail';
import { ReportPending } from './report-pending';

type View = 'tabla' | 'grilla' | 'graficos';
const VIEW_KEY = 'garita-cumplimiento-vista';
const views: { value: View; label: string }[] = [
  { value: 'tabla', label: 'Tabla' },
  { value: 'grilla', label: 'Grilla' },
  { value: 'graficos', label: 'Gráficos' },
];
// El almacenamiento puede fallar (modo privado, datos bloqueados): la vista se recuerda si se puede.
function readView(): View {
  try {
    const stored = localStorage.getItem(VIEW_KEY);
    if (views.some((view) => view.value === stored)) return stored as View;
  } catch {
    // sin almacenamiento: vista por defecto
  }
  return 'tabla';
}

type Period = 'hoy' | '7d' | '30d' | 'custom';
const periods: { value: Period; label: string; days: number }[] = [
  { value: 'hoy', label: 'Hoy', days: 1 },
  { value: '7d', label: '7 días', days: 7 },
  { value: '30d', label: '30 días', days: 30 },
];
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function ReportsPage() {
  const [filters, setFilters] = useState<ReportQuery>({});
  const [error, setError] = useState('');
  const [segment, setSegment] = useState<Record<string, string> | null>(null);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<View>(readView);
  const [period, setPeriod] = useState<Period>('custom');
  const query = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString();
  const report = useQuery({
    queryKey: ['reports', 'rounds', query],
    queryFn: () => apiGet(`/reportes/rondas?${query}`, reportResponseSchema),
    refetchOnWindowFocus: 'always',
  });
  const data = report.data;
  const chooseView = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // no se pudo recordar la vista
    }
  };
  // El período es hasta el fin de hoy (el "hasta" del informe no se incluye) en la zona de la empresa.
  const choosePeriod = (next: Period) => {
    const days = periods.find((item) => item.value === next)?.days ?? 1;
    const today = localReportDay(new Date(), data?.timezone ?? 'America/Argentina/Buenos_Aires');
    setPeriod(next);
    setFilters({ ...filters, desde: addDays(today, 1 - days), hasta: addDays(today, 1) });
    setSegment(null);
    setPage(1);
  };
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
    setPeriod('custom');
    setFilters(result.data);
    setSegment(null);
    setPage(1);
    const nextQuery = new URLSearchParams(
      Object.entries(result.data).filter((entry): entry is [string, string] => Boolean(entry[1])),
    ).toString();
    if (query === nextQuery) void report.refetch();
  };
  const periodQuery = data
    ? new URLSearchParams({ desde: data.desde, hasta: data.hasta }).toString()
    : '';
  const detailQuery = new URLSearchParams({
    ...filters,
    ...(data ? { desde: data.desde, hasta: data.hasta } : {}),
    ...segment,
  }).toString();
  const notDoneQuery = new URLSearchParams({
    ...filters,
    ...(data ? { desde: data.desde, hasta: data.hasta } : {}),
  }).toString();
  return (
    <section aria-labelledby="reports-title" className="space-y-6">
      <PageHeader
        id="reports-title"
        title="Cumplimiento"
        description="Ventanas cumplidas sobre las programadas. Una ventana tardía cuenta como cumplida y se marca aparte."
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedFilter
          ariaLabel="Período"
          options={periods}
          value={period}
          onChange={(next) => {
            if (next !== 'custom') choosePeriod(next);
          }}
        />
        <SegmentedFilter ariaLabel="Vista" options={views} value={view} onChange={chooseView} />
      </div>
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
      {report.isPending && (
        <div role="status" aria-label="Cargando cumplimiento" className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
      {report.isError && (
        <Alert variant="destructive" role="alert">
          No pudimos cargar el cumplimiento. Revisá los filtros o intentá de nuevo.{' '}
          <Button variant="outline" onClick={() => void report.refetch()}>
            Reintentar
          </Button>
        </Alert>
      )}
      {data && (
        <>
          <Alert variant="neutral" role="status">
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
          {view === 'tabla' && (
            <SiteComplianceTable
              sites={data.bySite}
              onSelect={(predio) => {
                select({ predio });
              }}
            />
          )}
          {view === 'grilla' && <WindowGrid days={data.daily} />}
          {view === 'graficos' && (
            <div className="space-y-6">
              <ComplianceChart
                title="Porcentaje de cumplimiento"
                percentage
                rows={[
                  {
                    id: 'total',
                    name: 'Cumplimiento del período',
                    value: data.totals.percentage,
                    tone: percentageTone(data.totals.percentage),
                  },
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
                    tone: 'delay',
                  },
                  {
                    id: 'incomplete',
                    name: 'Incompletas',
                    value: data.totals.incomplete,
                    tone: 'failure',
                  },
                  {
                    id: 'not_done',
                    name: 'No realizadas',
                    value: data.totals.not_done,
                    tone: 'failure',
                  },
                  {
                    id: 'in_review',
                    name: 'En revisión (fuera del porcentaje)',
                    value: data.totals.in_review,
                    tone: 'muted',
                  },
                  {
                    id: 'pending_sync',
                    name: 'Pendientes de sincronizar (fuera del porcentaje)',
                    value: data.totals.pending_sync,
                    tone: 'muted',
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
                  tone: percentageTone(site.totals.percentage),
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
                  tone: percentageTone(guard.totals.percentage),
                }))}
                onSelect={(vigilador) => {
                  select({ vigilador });
                }}
              />
            </div>
          )}
          {segment && (
            <ReportDetail
              key={detailQuery}
              query={detailQuery}
              page={page}
              onPage={setPage}
              timezone={data.timezone}
            />
          )}
          <NotDoneList query={notDoneQuery} timezone={data.timezone} />
          <ReportPending period={periodQuery} predio={filters.predio} timezone={data.timezone} />
        </>
      )}
    </section>
  );
}
