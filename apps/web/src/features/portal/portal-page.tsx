import { useState, type SyntheticEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  portalSitesSchema,
  portalRoundsSchema,
  portalIncidentsSchema,
  portalEmergenciesSchema,
  portalDaySchema,
  portalQuerySchema,
  PORTAL_STATUS_LABELS,
  INCIDENT_TYPE_LABELS,
  type PortalQuery,
} from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ComplianceChart } from '../reportes/charts/compliance-chart';
import { IncidentPhotos } from './incident-photos';

function Pages({
  page,
  total,
  onChange,
  label,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
  label: string;
}) {
  if (total <= 25) return null;
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        disabled={page === 1}
        onClick={() => {
          onChange(page - 1);
        }}
      >
        Anterior
      </Button>
      <span>
        Página {page} de {Math.ceil(total / 25)}
      </span>
      <Button
        variant="outline"
        disabled={page * 25 >= total}
        onClick={() => {
          onChange(page + 1);
        }}
      >
        Siguiente
      </Button>
    </nav>
  );
}

export function PortalPage() {
  const [filters, setFilters] = useState<PortalQuery>({});
  const [error, setError] = useState('');
  const [day, setDay] = useState<string | null>(null);
  const [dayPage, setDayPage] = useState(1);
  const [incidentPage, setIncidentPage] = useState(1);
  const [emergencyPage, setEmergencyPage] = useState(1);
  const query = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString();
  const sites = useQuery({
    queryKey: ['portal', 'sites'],
    queryFn: () => apiGet('/portal/predios', portalSitesSchema),
  });
  const rounds = useQuery({
    queryKey: ['portal', 'rounds', query],
    queryFn: () => apiGet(`/portal/rondas?${query}`, portalRoundsSchema),
    refetchOnWindowFocus: 'always',
  });
  const data = rounds.data;
  const period = new URLSearchParams({
    desde: data?.desde ?? '',
    hasta: data?.hasta ?? '',
    ...(filters.predio ? { predio: filters.predio } : {}),
  }).toString();
  const incidents = useQuery({
    queryKey: ['portal', 'incidents', period, incidentPage],
    queryFn: () =>
      apiGet(`/portal/incidentes?${period}&page=${incidentPage}`, portalIncidentsSchema),
    enabled: Boolean(data),
    refetchOnWindowFocus: 'always',
  });
  const emergencies = useQuery({
    queryKey: ['portal', 'emergencies', period, emergencyPage],
    queryFn: () =>
      apiGet(`/portal/emergencias?${period}&page=${emergencyPage}`, portalEmergenciesSchema),
    enabled: Boolean(data),
    refetchOnWindowFocus: 'always',
  });
  const dayQuery = new URLSearchParams({
    fecha: day ?? '',
    ...(filters.predio ? { predio: filters.predio } : {}),
    page: String(dayPage),
  }).toString();
  const detail = useQuery({
    queryKey: ['portal', 'day', dayQuery],
    queryFn: () => apiGet(`/portal/rondas/dia?${dayQuery}`, portalDaySchema),
    enabled: day !== null,
    refetchOnWindowFocus: 'always',
  });
  const dateTime = (value: string) =>
    new Date(value).toLocaleString('es-AR', { timeZone: data?.timezone ?? 'UTC' });
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = portalQuerySchema.safeParse(
      Object.fromEntries(
        [...new FormData(event.currentTarget)].filter(([, value]) => value !== ''),
      ),
    );
    if (!parsed.success) {
      setError('Ingresá inicio y fin, en orden y con un período de hasta 12 meses.');
      return;
    }
    const nextQuery = new URLSearchParams(
      Object.entries(parsed.data).filter((entry): entry is [string, string] => Boolean(entry[1])),
    ).toString();
    setError('');
    setFilters(parsed.data);
    setDay(null);
    setDayPage(1);
    setIncidentPage(1);
    setEmergencyPage(1);
    if (nextQuery === query) {
      void rounds.refetch();
      void incidents.refetch();
      void emergencies.refetch();
    }
  };
  return (
    <div className="min-w-0 space-y-6 break-words">
      <PageHeader
        title="Reportes de mis predios"
        description="Consultá el cumplimiento del servicio, los incidentes compartidos y las emergencias."
      />
      <form onSubmit={submit} className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0 space-y-2">
          <Label htmlFor="portal-site">Predio</Label>
          <NativeSelect id="portal-site" name="predio" className="w-full min-w-0">
            <NativeSelectOption value="">Todos mis predios</NativeSelectOption>
            {sites.data?.map((site) => (
              <NativeSelectOption key={site.id} value={site.id}>
                {site.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="portal-from">Desde</Label>
          <Input
            key={`from-${data?.desde}`}
            id="portal-from"
            name="desde"
            type="date"
            defaultValue={data?.desde}
            aria-describedby="portal-period"
          />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="portal-to">Hasta (sin incluir)</Label>
          <Input
            key={`to-${data?.hasta}`}
            id="portal-to"
            name="hasta"
            type="date"
            defaultValue={data?.hasta}
            aria-describedby="portal-period"
          />
        </div>
        <Button className="self-end" type="submit">
          Consultar
        </Button>
        <p id="portal-period" className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-4">
          Último mes por defecto. Máximo 12 meses. Fechas y horas en la zona de la empresa
          {data ? `: ${data.timezone}` : ''}.
        </p>
      </form>
      {error && <Alert role="alert">{error}</Alert>}
      {(sites.error ?? rounds.error) && (
        <Alert role="alert">
          No se pudo consultar el portal.{' '}
          <Button
            variant="outline"
            onClick={() => {
              void sites.refetch();
              void rounds.refetch();
            }}
          >
            Reintentar
          </Button>
        </Alert>
      )}
      {rounds.isPending && <p role="status">Cargando reporte…</p>}
      {data && (
        <>
          <section aria-label="Cumplimiento" className="space-y-4">
            <h2 className="t-headline">
              Cumplimiento:{' '}
              {data.totals.percentage === null
                ? 'Sin datos'
                : `${data.totals.percentage.toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`}
            </h2>
            <p>
              Rondas completas sobre rondas evaluadas. Las rondas en verificación se muestran
              aparte.
            </p>
            <Alert role="status">
              {data.totals.en_verificacion} rondas en verificación. {data.verificationMessage}.
            </Alert>
            {data.totals.evaluated === 0 && (
              <EmptyState
                title="Sin rondas evaluadas"
                description="Probá otro período o predio; las rondas en verificación aún no cuentan en el porcentaje."
              />
            )}
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <ComplianceChart
                title="Rondas por estado"
                rows={(['completa', 'incompleta', 'no_realizada'] as const).map((status) => ({
                  id: status,
                  name: PORTAL_STATUS_LABELS[status],
                  value: data.totals[status],
                  tone: status === 'completa' ? 'ink' : 'failure',
                }))}
              />
              <ComplianceChart
                title="Evolución diaria del cumplimiento"
                percentage
                evolution
                rows={data.daily.map((row) => ({
                  id: row.date,
                  name: row.date,
                  value: row.totals.percentage,
                }))}
                onSelect={(date) => {
                  setDay(date);
                  setDayPage(1);
                }}
              />
            </div>
          </section>
          {day && (
            <section aria-label={`Rondas del ${day}`} className="space-y-3">
              <h2 className="t-headline">Rondas del {day}</h2>
              {detail.isPending && <p role="status">Cargando rondas…</p>}
              {detail.error && (
                <Alert role="alert">
                  No se pudieron cargar las rondas.{' '}
                  <Button variant="outline" onClick={() => void detail.refetch()}>
                    Reintentar rondas
                  </Button>
                </Alert>
              )}
              {detail.data?.items.length === 0 && (
                <EmptyState
                  title="Sin rondas para este día"
                  description="Elegí otro día en la tabla de evolución."
                />
              )}
              <ul className="space-y-3">
                {detail.data?.items.map((row, index) => (
                  <li key={index} className="border-b pb-3">
                    <p>{row.site.name}</p>
                    <p className="tabular-nums">
                      {dateTime(row.startsAt)} — {dateTime(row.endsAt)}
                    </p>
                    <p>● {PORTAL_STATUS_LABELS[row.status]}</p>
                  </li>
                ))}
              </ul>
              {detail.data && (
                <Pages
                  page={dayPage}
                  total={detail.data.total}
                  onChange={setDayPage}
                  label="Páginas de rondas"
                />
              )}
            </section>
          )}
          <section aria-label="Incidentes" className="space-y-3">
            <h2 className="t-headline">Incidentes compartidos</h2>
            {incidents.isPending && <p role="status">Cargando incidentes…</p>}
            {incidents.error && (
              <Alert role="alert">
                No se pudieron cargar los incidentes.{' '}
                <Button variant="outline" onClick={() => void incidents.refetch()}>
                  Reintentar incidentes
                </Button>
              </Alert>
            )}
            {incidents.data?.items.length === 0 && (
              <EmptyState
                title="Sin incidentes compartidos"
                description="No hay incidentes visibles en el período elegido."
              />
            )}
            {incidents.data?.items.map((incident) => (
              <Card key={incident.id}>
                <CardHeader>
                  <CardTitle>{INCIDENT_TYPE_LABELS[incident.type]}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p>
                    {incident.site.name} · {dateTime(incident.occurredAt)}
                  </p>
                  <p className="whitespace-pre-wrap break-words">
                    {incident.clientNote ?? 'Sin nota para el cliente.'}
                  </p>
                  <IncidentPhotos id={incident.id} count={incident.photoCount} />
                </CardContent>
              </Card>
            ))}
            {incidents.data && (
              <Pages
                page={incidentPage}
                total={incidents.data.total}
                onChange={setIncidentPage}
                label="Páginas de incidentes"
              />
            )}
          </section>
          <section aria-label="Emergencias" className="space-y-3">
            <h2 className="t-headline">Emergencias</h2>
            {emergencies.isPending && <p role="status">Cargando emergencias…</p>}
            {emergencies.error && (
              <Alert role="alert">
                No se pudieron cargar las emergencias.{' '}
                <Button variant="outline" onClick={() => void emergencies.refetch()}>
                  Reintentar emergencias
                </Button>
              </Alert>
            )}
            {emergencies.data?.items.length === 0 && (
              <EmptyState
                title="Sin emergencias"
                description="No hay emergencias resueltas en el período elegido."
              />
            )}
            <ul className="space-y-3">
              {emergencies.data?.items.map((emergency, index) => (
                <li key={index} className="border-b pb-3">
                  <p>
                    {emergency.site.name} · {dateTime(emergency.triggeredAt)}
                  </p>
                  <p>
                    Tiempo de respuesta de la empresa:{' '}
                    {(emergency.responseTimeMs / 1000).toLocaleString('es-AR')} segundos
                  </p>
                </li>
              ))}
            </ul>
            {emergencies.data && (
              <Pages
                page={emergencyPage}
                total={emergencies.data.total}
                onChange={setEmergencyPage}
                label="Páginas de emergencias"
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
