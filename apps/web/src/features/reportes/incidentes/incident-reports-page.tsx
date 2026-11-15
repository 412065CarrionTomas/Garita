import { useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  incidentReportQuerySchema,
  incidentReportResponseSchema,
  responseTimesReportSchema,
  panicReportResponseSchema,
  localReportDay,
  type IncidentReportQuery,
} from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/page-header';
import { SegmentedFilter } from '@/components/segmented-filter';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { CountChart } from '../charts/count-chart';
import { ResponseTimes } from './response-times';
import { SegmentDetail } from './segment-detail';

const periods = [
  { value: 'hoy', label: 'Hoy', days: 1 },
  { value: '7d', label: '7 días', days: 7 },
  { value: '30d', label: '30 días', days: 30 },
];
export function IncidentReportsPage() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<IncidentReportQuery>({});
  const [period, setPeriod] = useState('custom');
  const [error, setError] = useState('');
  const [segment, setSegment] = useState<{
    kind: 'incidentes' | 'panico';
    filters: Record<string, string>;
  } | null>(null);
  const [page, setPage] = useState(1);
  const query = new URLSearchParams(filters).toString();
  const incidents = useQuery({
    queryKey: ['reports', 'incidents', query],
    queryFn: () => apiGet(`/reportes/incidentes?${query}`, incidentReportResponseSchema),
    refetchOnWindowFocus: 'always',
  });
  const times = useQuery({
    queryKey: ['reports', 'response-times', query],
    queryFn: () => apiGet(`/reportes/tiempos-de-respuesta?${query}`, responseTimesReportSchema),
    refetchOnWindowFocus: 'always',
  });
  const panic = useQuery({
    queryKey: ['reports', 'panic', query],
    queryFn: () => apiGet(`/reportes/panico?${query}`, panicReportResponseSchema),
    refetchOnWindowFocus: 'always',
  });
  const data = incidents.data;
  const select = (kind: 'incidentes' | 'panico', key: string, value: string) => {
    setSegment({ kind, filters: { [key]: value } });
    setPage(1);
  };
  const refresh = () => {
    void incidents.refetch();
    void times.refetch();
    void panic.refetch();
  };
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = incidentReportQuerySchema.safeParse(
      Object.fromEntries(
        [...new FormData(event.currentTarget)].filter(([, value]) => value !== ''),
      ),
    );
    if (!result.success) {
      setError('Ingresá un período válido, con inicio anterior al fin y de hasta 12 meses.');
      return;
    }
    setError('');
    setFilters(result.data);
    setPeriod('custom');
    setSegment(null);
    setPage(1);
    if (new URLSearchParams(result.data).toString() === query) refresh();
  };
  const choosePeriod = (value: string) => {
    const days = periods.find((item) => item.value === value)?.days ?? 1;
    const today = localReportDay(new Date(), data?.timezone ?? 'America/Argentina/Buenos_Aires');
    const add = (days: number) => {
      const day = new Date(`${today}T00:00:00Z`);
      day.setUTCDate(day.getUTCDate() + days);
      return day.toISOString().slice(0, 10);
    };
    setFilters({ ...filters, desde: add(1 - days), hasta: add(1) });
    setPeriod(value);
    setSegment(null);
    setPage(1);
    setError('');
  };
  const age = data?.pending.oldestAgeMs;
  const ageText =
    age == null
      ? ''
      : age >= 86400_000
        ? `${Math.floor(age / 86400_000)} días`
        : `${Math.floor(age / 3600_000)} h`;
  return (
    <section aria-labelledby="incident-reports-title" className="space-y-6">
      <PageHeader
        id="incident-reports-title"
        title="Incidentes y respuesta"
        description="Dónde ocurren los incidentes y cuánto tarda la atención del equipo."
      />
      <SegmentedFilter
        ariaLabel="Período"
        options={periods}
        value={period}
        onChange={choosePeriod}
      />
      <Card>
        <CardContent className="py-4">
          <form
            key={`${data?.desde}-${data?.hasta}-${filters.desde}-${filters.hasta}`}
            aria-label="Filtros de incidentes y respuesta"
            className="space-y-4"
            onSubmit={submit}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="incidents-from">Desde</Label>
                <Input
                  id="incidents-from"
                  name="desde"
                  type="date"
                  required
                  defaultValue={filters.desde ?? data?.desde}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="incidents-to">Hasta (sin incluir)</Label>
                <Input
                  id="incidents-to"
                  name="hasta"
                  type="date"
                  required
                  defaultValue={filters.hasta ?? data?.hasta}
                />
              </div>
              {(['predio', 'cliente'] as const).map((key) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={`incidents-${key}`}>
                    {key === 'predio' ? 'Predio' : 'Cliente'}
                  </Label>
                  <NativeSelect
                    id={`incidents-${key}`}
                    name={key}
                    defaultValue={filters[key] ?? ''}
                  >
                    <NativeSelectOption value="">Todos</NativeSelectOption>
                    {(key === 'predio' ? data?.filters.sites : data?.filters.clients)?.map(
                      (item) => (
                        <NativeSelectOption key={item.id} value={item.id}>
                          {item.name}
                        </NativeSelectOption>
                      ),
                    )}
                  </NativeSelect>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Fechas en la zona de la empresa{data ? `: ${data.timezone}` : ''}. Por defecto, último
              mes hasta el inicio de hoy.
            </p>
            {error && <Alert role="alert">{error}</Alert>}
            <Button
              type="submit"
              disabled={incidents.isFetching || times.isFetching || panic.isFetching}
            >
              Consultar reportes
            </Button>
          </form>
        </CardContent>
      </Card>
      {(incidents.isPending || times.isPending || panic.isPending) && (
        <p role="status">Cargando reportes…</p>
      )}
      {(incidents.isError || times.isError || panic.isError) && (
        <Alert role="alert">
          No pudimos cargar todos los reportes.{' '}
          <Button variant="outline" onClick={refresh}>
            Reintentar
          </Button>
        </Alert>
      )}
      {data && (
        <>
          <Alert role="status">
            {data.pending.count} incidentes pendientes de clasificar
            {ageText && `, el más antiguo de hace ${ageText}`}.{' '}
            <Link className="underline" to="/incidentes/cola">
              Abrir cola de clasificación
            </Link>
          </Alert>
          <div className="grid gap-6 lg:grid-cols-2">
            <CountChart
              title="Incidentes por tipo"
              rows={data.byType}
              onSelect={(id) => {
                select('incidentes', 'tipo', id);
              }}
            />
            <CountChart
              title="Incidentes por franja de dos horas"
              rows={data.byTimeBand}
              onSelect={(id) => {
                select('incidentes', 'franja', id);
              }}
            />
            <CountChart
              title="Incidentes por predio"
              rows={data.bySite}
              onSelect={(id) => {
                select('incidentes', 'predio', id);
              }}
            />
            <CountChart
              title="Incidentes por clasificación"
              rows={data.byClassification}
              onSelect={(id) => {
                select('incidentes', 'clasificacion', id);
              }}
            />
          </div>
        </>
      )}
      {times.data && <ResponseTimes data={times.data} isAdmin={user?.role === 'admin'} />}
      {panic.data && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <CountChart
              title="Pánico por resultado"
              rows={panic.data.byOutcome}
              onSelect={(id) => {
                select('panico', 'resultado', id);
              }}
            />
            <CountChart
              title="Pánico por canal"
              rows={panic.data.byChannel}
              onSelect={(id) => {
                select('panico', 'canal', id);
              }}
            />
          </div>
          <p>
            Proporción de falsas alarmas sobre todas las alertas:{' '}
            {panic.data.falseAlarmProportion === null
              ? 'Sin datos'
              : `${(panic.data.falseAlarmProportion * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`}
          </p>
        </>
      )}
      {segment && data && (
        <SegmentDetail
          kind={segment.kind}
          query={new URLSearchParams({
            ...filters,
            desde: data.desde,
            hasta: data.hasta,
            ...segment.filters,
          }).toString()}
          page={page}
          onPage={setPage}
          timezone={data.timezone}
        />
      )}
    </section>
  );
}
