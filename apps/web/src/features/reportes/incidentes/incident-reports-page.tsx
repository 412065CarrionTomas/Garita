import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  INCIDENT_TYPE_LABELS,
  incidentReportQuerySchema,
  incidentReportResponseSchema,
  localReportDay,
  panicReportResponseSchema,
  responseTimesReportSchema,
} from '@garita/shared';
import { DataTable } from '@/components/data-table';
import { Kpi } from '@/components/kpi';
import { PageHeader } from '@/components/page-header';
import { SegmentedFilter } from '@/components/segmented-filter';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/auth-context';
import { SeverityBadge, ageText } from '@/features/incidentes/incident-ui';
import { apiGet } from '@/lib/api-client';
import { ExportPdfButton } from '../export-pdf-button';
import { CountBars } from './count-bars';
import { Heatmap } from './heatmap';
import { minutes } from './format';
import { ResponseTimes } from './response-times';
import { SegmentDetail, type Segment } from './segment-detail';

const PERIODS = [
  { value: 'hoy', label: 'Hoy', days: 1 },
  { value: '7d', label: '7 días', days: 7 },
  { value: '30d', label: '30 días', days: 30 },
  { value: 'custom', label: 'Fechas', days: 0 },
] as const;
type Period = (typeof PERIODS)[number]['value'];
const DEFAULT_TZ = 'America/Argentina/Buenos_Aires';

function addDays(day: string, delta: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/**
 * "+3 respecto del período anterior"; sin datos previos no compara. La igualdad se decide con el
 * valor ya redondeado, así nunca aparece "+0 min".
 */
function delta(current: number | null, previous: number | null, format = (n: number) => String(n)) {
  if (current === null || previous === null) return 'Sin datos del período anterior';
  const diff = current - previous;
  const text = format(Math.abs(diff));
  if (text === format(0)) return 'Igual que el período anterior';
  return `${diff > 0 ? '+' : '−'}${text} respecto del período anterior`;
}
/** Diferencia entre dos proporciones, en puntos porcentuales. */
const points = (value: number) =>
  `${(value * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })} pp`;
const dayText = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('es-AR', { timeZone: 'UTC' });
const percent = (value: number | null) =>
  value === null ? '—' : `${(value * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="t-headline">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function IncidentReportsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [segment, setSegment] = useState<Segment | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  // Borrador de fechas (hasta inclusiva) mientras lo escrito no forma un período válido.
  const [draft, setDraft] = useState<{ desde: string; hasta: string } | null>(null);
  const filters = Object.fromEntries(
    (['desde', 'hasta', 'predio', 'cliente'] as const).flatMap((key) => {
      const value = params.get(key);
      return value ? [[key, value]] : [];
    }),
  );
  const valid = incidentReportQuerySchema.safeParse(filters);
  // La clave siempre lleva los filtros: con un período inválido no se consulta (enabled) y queda lo
  // último válido de esos mismos filtros, no lo cacheado sin filtrar.
  const query = new URLSearchParams(filters).toString();
  // Con un período inválido no se consulta nada: se conserva lo último válido debajo del aviso.
  const options = {
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: 'always' as const,
    enabled: valid.success,
  };
  const incidents = useQuery({
    queryKey: ['reports', 'incidents', query],
    queryFn: () => apiGet(`/reportes/incidentes?${query}`, incidentReportResponseSchema),
    ...options,
  });
  const times = useQuery({
    queryKey: ['reports', 'response-times', query],
    queryFn: () => apiGet(`/reportes/tiempos-de-respuesta?${query}`, responseTimesReportSchema),
    ...options,
  });
  const panic = useQuery({
    queryKey: ['reports', 'panic', query],
    queryFn: () => apiGet(`/reportes/panico?${query}`, panicReportResponseSchema),
    ...options,
  });
  const data = incidents.data;
  const timezone = data?.timezone ?? DEFAULT_TZ;
  // El botón activo sale de las fechas consultadas, no de un parámetro aparte.
  const today = localReportDay(new Date(), timezone);
  const shownFrom = params.get('desde') ?? data?.desde;
  const shownTo = params.get('hasta') ?? data?.hasta;
  const preset = PERIODS.find(
    (item) =>
      item.days > 0 && shownFrom === addDays(today, 1 - item.days) && shownTo === addDays(today, 1),
  );
  const period: Period = customOpen || !preset ? 'custom' : preset.value;
  // En pantalla la fecha final es inclusiva (como en Cumplimiento); la API recibe el día siguiente.
  const dates = draft ?? {
    desde: shownFrom ?? '',
    hasta: shownTo ? addDays(shownTo, -1) : '',
  };
  const draftInvalid = draft !== null;
  const editDates = (next: { desde: string; hasta: string }) => {
    if (next.desde && next.hasta && next.desde <= next.hasta) {
      setDraft(null);
      update({ desde: next.desde, hasta: addDays(next.hasta, 1) });
    } else setDraft(next);
  };

  const update = (changes: Record<string, string | null>) => {
    setSegment(null);
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        for (const [key, value] of Object.entries(changes))
          if (value) next.set(key, value);
          else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };
  const choosePeriod = (value: Period) => {
    const chosen = PERIODS.find((item) => item.value === value);
    if (!chosen || value === 'custom') {
      setCustomOpen(true);
      update({ desde: shownFrom ?? null, hasta: shownTo ?? null });
      return;
    }
    setCustomOpen(false);
    update({ desde: addDays(today, 1 - chosen.days), hasta: addDays(today, 1) });
  };
  const open = (kind: Segment['kind'], title: string, segmentFilters: Record<string, string>) => {
    setSegment({ kind, title, filters: segmentFilters });
  };
  const fetching = incidents.isFetching || times.isFetching || panic.isFetching;
  const refresh = () => {
    void incidents.refetch();
    void times.refetch();
    void panic.refetch();
  };

  return (
    <main aria-labelledby="incident-reports-title" className="space-y-6">
      <PageHeader
        id="incident-reports-title"
        title="Incidentes y respuesta"
        description="Qué pasa, cuándo y dónde, y qué tan rápido responde el equipo."
        actions={
          <ExportPdfButton
            endpoint="/reportes/incidentes/pdf"
            filters={{ ...filters, ...(data ? { desde: data.desde, hasta: data.hasta } : {}) }}
            disabled={!data || fetching || !valid.success}
          />
        }
      />
      <div
        role="search"
        aria-label="Filtros del reporte"
        className="flex flex-wrap items-center gap-2"
      >
        <SegmentedFilter<Period>
          ariaLabel="Período"
          options={PERIODS.map(({ value, label }) => ({ value, label }))}
          value={period}
          onChange={choosePeriod}
          className="[&>button]:h-10"
        />
        {period === 'custom' && (
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label="Desde"
              className="w-auto"
              value={dates.desde}
              onChange={(event) => {
                editDates({ ...dates, desde: event.target.value });
              }}
            />
            <span aria-hidden="true" className="text-muted-foreground">
              –
            </span>
            <Input
              type="date"
              aria-label="Hasta"
              className="w-auto"
              value={dates.hasta}
              onChange={(event) => {
                editDates({ ...dates, hasta: event.target.value });
              }}
            />
          </div>
        )}
        {(['predio', 'cliente'] as const).map((key) => (
          <NativeSelect
            key={key}
            aria-label={key === 'predio' ? 'Predio' : 'Cliente'}
            className="w-full sm:w-auto sm:max-w-60"
            value={params.get(key) ?? ''}
            onChange={(event) => {
              update({ [key]: event.target.value });
            }}
          >
            <NativeSelectOption value="">
              {key === 'predio' ? 'Todos los predios' : 'Todos los clientes'}
            </NativeSelectOption>
            {(key === 'predio' ? data?.filters.sites : data?.filters.clients)?.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ))}
        {data && (
          <p className="text-sm text-muted-foreground tabular-nums sm:ml-auto">
            {dayText(data.desde)} al {dayText(addDays(data.hasta, -1))}
          </p>
        )}
      </div>
      {(!valid.success || draftInvalid) && (
        <Alert role="alert">
          El período no es válido: el inicio va antes del fin y abarca hasta 12 meses.
        </Alert>
      )}
      {(incidents.isError || times.isError || panic.isError) && (
        <Alert role="alert">
          No pudimos cargar todo el reporte.{' '}
          <Button variant="outline" size="sm" onClick={refresh}>
            Reintentar
          </Button>
        </Alert>
      )}
      {!data || !times.data || !panic.data ? (
        <div role="status" className="space-y-3">
          <span className="sr-only">Cargando reporte…</span>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : (
        <>
          <dl className="grid gap-px border-[1.5px] border-input bg-border sm:grid-cols-3 xl:grid-cols-6">
            <Kpi
              label="Incidentes"
              value={data.total}
              detail={delta(data.total, data.previous.total)}
            />
            <Kpi
              label="Gravedad alta"
              value={data.highSeverity}
              tone={data.highSeverity ? 'text-danger' : undefined}
              detail={delta(data.highSeverity, data.previous.highSeverity)}
            />
            <Kpi
              label="Seguimiento abierto"
              value={data.openFollowUpsTotal}
              detail="Pendientes hoy, de cualquier fecha"
            />
            <Kpi
              label="Clasificación"
              value={minutes(times.data.totals.classification.averageMs)}
              detail={delta(
                times.data.totals.classification.averageMs,
                times.data.previousTotals.classification.averageMs,
                (n) => minutes(n),
              )}
            />
            <Kpi
              label="Respuesta a pánico"
              value={minutes(times.data.totals.panic.averageMs)}
              detail={delta(
                times.data.totals.panic.averageMs,
                times.data.previousTotals.panic.averageMs,
                (n) => minutes(n),
              )}
            />
            <Kpi
              label="Falsas alarmas"
              value={percent(panic.data.falseAlarmProportion)}
              detail={delta(
                panic.data.falseAlarmProportion,
                panic.data.previous.falseAlarmProportion,
                points,
              )}
            />
          </dl>

          <Section id="distribution-title" title="Dónde y cuándo">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Heatmap
                grid={data.byWeekdayTimeBand}
                onSelect={(day, band, label) => {
                  open('incidentes', label, { dia: String(day), franja: String(band) });
                }}
              />
              <CountBars
                title="Por tipo"
                rows={[...data.byType].sort((a, b) => b.value - a.value)}
                onSelect={(id, name) => {
                  open('incidentes', name, { tipo: id });
                }}
              />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <CountBars
                title="Por predio"
                rows={data.bySite}
                onSelect={(id, name) => {
                  open('incidentes', name, { predio: id });
                }}
              />
              <CountBars
                title="Por gravedad"
                rows={data.bySeverity}
                barClassName={(row) => (row.id === 'high' ? 'bg-danger' : undefined)}
                empty="Todavía no hay incidentes clasificados en el período."
                onSelect={(id, name) => {
                  open('incidentes', `Gravedad ${name.toLowerCase()}`, { gravedad: id });
                }}
              />
            </div>
          </Section>

          <Section id="follow-up-title" title="Seguimiento abierto">
            {data.openFollowUps.length ? (
              <div className="space-y-2">
                {data.openFollowUpsTotal > data.openFollowUps.length && (
                  <p className="text-muted-foreground">
                    Se muestran los {data.openFollowUps.length} más prioritarios de{' '}
                    {data.openFollowUpsTotal}. El resto está en Incidentes → Todos, filtrando por
                    seguimiento abierto.
                  </p>
                )}
                <div className="overflow-x-auto border-[1.5px] border-input">
                  <DataTable
                    label="Incidentes con seguimiento abierto"
                    rows={data.openFollowUps}
                    getRowId={(row) => row.id}
                    columns={[
                      {
                        id: 'type',
                        header: 'Incidente',
                        value: (row) => INCIDENT_TYPE_LABELS[row.type],
                        cell: (row) => (
                          <Link
                            to={`/incidentes/${row.id}`}
                            className="font-semibold underline-offset-4 hover:underline"
                          >
                            {INCIDENT_TYPE_LABELS[row.type]}
                          </Link>
                        ),
                      },
                      { id: 'site', header: 'Predio', width: 220, value: (row) => row.site.name },
                      {
                        id: 'severity',
                        header: 'Gravedad',
                        width: 110,
                        cell: (row) => <SeverityBadge severity={row.severity} />,
                      },
                      {
                        id: 'age',
                        header: 'Abierto',
                        type: 'number',
                        width: 120,
                        value: (row) => row.ageMs,
                        cell: (row) => <span className="tabular-nums">{ageText(row.ageMs)}</span>,
                      },
                      {
                        id: 'last',
                        header: 'Última acción',
                        value: (row) => row.lastAction ?? '',
                        cell: (row) =>
                          row.lastAction ?? (
                            <span className="text-muted-foreground">Sin acciones todavía</span>
                          ),
                      },
                    ]}
                  />
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">
                No hay incidentes con seguimiento abierto. Se abren al clasificar uno marcando
                “Requiere seguimiento”.
              </p>
            )}
          </Section>

          <ResponseTimes data={times.data} isAdmin={user?.role === 'admin'} />

          <Section id="panic-title" title="Alertas de pánico">
            <div className="grid gap-4 lg:grid-cols-2">
              <CountBars
                title={`Por resultado (${String(panic.data.total)} alertas)`}
                rows={panic.data.byOutcome}
                barClassName={(row) => (row.id === 'false_alarm' ? 'bg-warning' : undefined)}
                onSelect={(id, name) => {
                  open('panico', name, { resultado: id });
                }}
              />
              <CountBars
                title="Por canal"
                rows={panic.data.byChannel}
                onSelect={(id, name) => {
                  open('panico', `Canal ${name}`, { canal: id });
                }}
              />
            </div>
          </Section>
        </>
      )}
      {segment && data && (
        <SegmentDetail
          segment={segment}
          baseQuery={{ ...filters, desde: data.desde, hasta: data.hasta }}
          timezone={timezone}
          onClose={() => {
            setSegment(null);
          }}
        />
      )}
    </main>
  );
}
