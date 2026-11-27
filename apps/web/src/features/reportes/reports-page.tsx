import { useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { ComplianceChart } from './charts/compliance-chart';
import { COMPLIANCE_THRESHOLD, percentageTone } from './charts/compliance-tone';
import { SiteComplianceTable, WindowGrid } from './compliance-views';
import { NotDoneList } from './not-done-list';
import { ReportDetail } from './report-detail';
import { ReportPending } from './report-pending';
import { ExportPdfButton } from './export-pdf-button';
import { Panel } from './panel';
import { Kpi } from '@/components/kpi';
import { Stamp } from '@/components/stamp';

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
const dateLabel = (day: string) => day.split('-').reverse().join('/');
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  // Fecha inválida o fuera de rango: se devuelve tal cual y la rechaza la validación del período.
  return Number.isNaN(date.getTime()) ? day : date.toISOString().slice(0, 10);
}

export function ReportsPage() {
  const [filters, setFilters] = useState<ReportQuery>({});
  const [error, setError] = useState('');
  const [segment, setSegment] = useState<Record<string, string> | null>(null);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<View>(readView);
  // Fechas tal como las escribió el usuario (el "hasta" incluido) mientras no formen un período válido.
  const [draft, setDraft] = useState<{ desde?: string; hasta?: string }>({});
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
  // Cada cambio de filtro consulta solo; el "hasta" de la API no se incluye, en pantalla sí.
  const apply = (next: ReportQuery) => {
    // Sin claves vacías: las consultas de detalle las mandarían como "undefined".
    setFilters(Object.fromEntries(Object.entries(next).filter(([, value]) => value)));
    setDraft({});
    setError('');
    setSegment(null);
    setPage(1);
  };
  const timezone = data?.timezone ?? 'America/Argentina/Buenos_Aires';
  const today = localReportDay(new Date(), timezone);
  const from = filters.desde ?? data?.desde;
  const to = filters.hasta ?? data?.hasta;
  const shownFrom = draft.desde ?? from ?? '';
  const shownTo = draft.hasta ?? (to ? addDays(to, -1) : '');
  // El atajo marcado sale de las fechas: si se cambian a mano, deja de estar marcado.
  const period: Period =
    periods.find(
      (item) =>
        filters.hasta === addDays(today, 1) && filters.desde === addDays(today, 1 - item.days),
    )?.value ?? 'custom';
  const choosePeriod = (next: Period) => {
    // Tocar el atajo marcado lo desmarca y vuelve al período por defecto.
    if (next === period) {
      apply({ ...filters, desde: undefined, hasta: undefined });
      return;
    }
    const days = periods.find((item) => item.value === next)?.days ?? 1;
    apply({ ...filters, desde: addDays(today, 1 - days), hasta: addDays(today, 1) });
  };
  const changeDate = (name: 'desde' | 'hasta', value: string) => {
    const dates = { desde: shownFrom, hasta: shownTo, [name]: value };
    setDraft(dates);
    const result = reportQuerySchema.safeParse({
      ...filters,
      desde: dates.desde || undefined,
      hasta: dates.hasta ? addDays(dates.hasta, 1) : undefined,
    });
    if (result.success) apply(result.data);
    else
      setError(
        'Ingresá un período válido: el inicio no puede ser posterior al fin y hasta 12 meses.',
      );
  };
  const select = (value: Record<string, string>) => {
    setSegment(value);
    setPage(1);
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
  const percent = (value: number) =>
    `${value.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`;
  return (
    <section aria-labelledby="reports-title" className="space-y-4">
      <PageHeader
        id="reports-title"
        title="Cumplimiento"
        description="Ventanas cumplidas sobre las programadas. Una ventana tardía cuenta como cumplida y se marca aparte."
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
        }}
        aria-label="Filtros de cumplimiento"
        className="space-y-2 rounded-md border border-border bg-card p-3"
      >
        <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] 2xl:grid-cols-[repeat(3,auto)_repeat(3,minmax(0,1fr))_auto]">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-6 2xl:col-span-1">
            <span className="t-label block text-foreground">Período</span>
            <SegmentedFilter
              ariaLabel="Período"
              options={periods}
              value={period}
              onChange={choosePeriod}
              className="[&>button]:h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-from">Desde</Label>
            <Input
              id="report-from"
              name="desde"
              type="date"
              className="2xl:w-40"
              value={shownFrom}
              onChange={(event) => {
                changeDate('desde', event.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-to">Hasta</Label>
            <Input
              id="report-to"
              name="hasta"
              type="date"
              className="2xl:w-40"
              min={shownFrom || undefined}
              value={shownTo}
              onChange={(event) => {
                changeDate('hasta', event.target.value);
              }}
            />
          </div>
          {(['predio', 'cliente', 'vigilador'] as const).map((key) => (
            <div className="space-y-1.5" key={key}>
              <Label htmlFor={`report-${key}`}>
                {key === 'predio' ? 'Predio' : key === 'cliente' ? 'Cliente' : 'Vigilador'}
              </Label>
              <NativeSelect
                id={`report-${key}`}
                name={key}
                className="w-full"
                value={filters[key] ?? ''}
                onChange={(event) => {
                  apply({ ...filters, [key]: event.target.value || undefined });
                }}
              >
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
          <div className="lg:ml-2">
            <ExportPdfButton
              iconOnly
              endpoint="/reportes/rondas/pdf"
              filters={{ ...filters, ...(data ? { desde: data.desde, hasta: data.hasta } : {}) }}
              disabled={!data || report.isFetching}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {from && to
            ? `Del ${dateLabel(from)} al ${dateLabel(addDays(to, -1))}, ambos incluidos`
            : 'Último mes hasta ayer'}
          {period === 'custom' && !filters.desde && ' (período por defecto)'}
          {' · '}
          {filters.predio || filters.cliente || filters.vigilador
            ? 'con los filtros elegidos'
            : 'todos los predios, clientes y vigiladores'}
          {' · '}hora de {timezone}
          {report.isFetching && ' · Actualizando…'}
        </p>
        {error && <Alert role="alert">{error}</Alert>}
      </form>
      {report.isPending && (
        <div role="status" aria-label="Cargando cumplimiento" className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
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
          <div className="overflow-hidden rounded-md border border-border">
            <dl className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-5">
              <Kpi
                label="Cumplimiento"
                value={
                  data.totals.percentage === null ? 'Sin datos' : percent(data.totals.percentage)
                }
                stamp={
                  data.totals.percentage !== null &&
                  data.totals.percentage < COMPLIANCE_THRESHOLD && (
                    <Stamp variant="fail">REVISAR</Stamp>
                  )
                }
                detail={`${data.totals.complete} completas de ${data.totals.evaluated} evaluadas`}
                className="sm:col-span-2 lg:col-span-1"
              />
              <Kpi
                label="Con demora"
                value={data.totals.complete_late}
                tone={data.totals.complete_late > 0 ? 'text-warning' : undefined}
                detail="Cuentan como cumplidas"
              />
              <Kpi
                label="Incompletas"
                value={data.totals.incomplete}
                tone={data.totals.incomplete > 0 ? 'text-danger' : undefined}
                detail="Les faltaron puntos"
              />
              <Kpi
                label="No realizadas"
                value={data.totals.not_done}
                tone={data.totals.not_done > 0 ? 'text-danger' : undefined}
                detail="Sin ningún registro"
              />
              <Kpi
                label="Fuera del porcentaje"
                value={data.totals.in_review + data.totals.pending_sync}
                detail={`${data.totals.in_review} en revisión · ${data.totals.pending_sync} sin sincronizar`}
              />
            </dl>
            <p className="border-t border-border bg-muted px-4 py-2 text-sm text-muted-foreground">
              <span className="t-label mr-2 text-foreground">Completas</span>
              {data.totals.withoutObservations} sin observaciones · {data.totals.media} con
              observaciones medias · {data.totals.leve} leves · {data.totals.validated} validadas
            </p>
          </div>
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_--spacing(88)] 2xl:grid-cols-[minmax(0,1fr)_--spacing(104)]">
            <div className="min-w-0 space-y-4">
              <Panel
                title={viewTitles[view]}
                actions={
                  <SegmentedFilter
                    ariaLabel="Vista"
                    options={views}
                    value={view}
                    onChange={chooseView}
                  />
                }
                bodyClassName={view === 'graficos' ? undefined : 'max-h-112'}
              >
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
                  <div className="grid divide-y divide-border lg:grid-cols-2">
                    <ComplianceChart
                      title="Evolución diaria del cumplimiento"
                      percentage
                      evolution
                      className="lg:col-span-2"
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
                      title="Rondas por estado"
                      fill
                      className="lg:border-r lg:border-border"
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
                          name: 'En revisión',
                          description: 'Fuera del porcentaje',
                          value: data.totals.in_review,
                          tone: 'muted',
                        },
                        {
                          id: 'pending_sync',
                          name: 'Sin sincronizar',
                          description: 'Fuera del porcentaje',
                          value: data.totals.pending_sync,
                          tone: 'muted',
                        },
                      ]}
                      onSelect={(estado) => {
                        select({ estado });
                      }}
                    />
                    <ComplianceChart
                      title="Cumplimiento por predio"
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
                      title="Cumplimiento por vigilador"
                      percentage
                      className="lg:col-span-2"
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
              </Panel>
              {segment && (
                <ReportDetail
                  key={detailQuery}
                  query={detailQuery}
                  page={page}
                  onPage={setPage}
                  timezone={data.timezone}
                  onClose={() => {
                    setSegment(null);
                  }}
                />
              )}
              <NotDoneList query={notDoneQuery} timezone={data.timezone} />
            </div>
            <aside aria-label="Pendientes y puntos" className="min-w-0 space-y-4">
              <ReportPending
                period={periodQuery}
                predio={filters.predio}
                timezone={data.timezone}
              />
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

const viewTitles: Record<View, string> = {
  tabla: 'Por predio',
  grilla: 'Ventanas por día',
  graficos: 'Gráficos',
};
