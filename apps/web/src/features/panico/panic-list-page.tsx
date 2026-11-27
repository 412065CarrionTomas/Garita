import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { z } from 'zod';
import { DataTable } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { EmptyState } from '@/components/empty-state';
import { SegmentedFilter } from '@/components/segmented-filter';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { apiGet } from '@/lib/api-client';
import { lastPage } from '@/lib/page-items';
import { panicListSchema, panicStatuses } from './queries';
import { SmsBadges } from './sms-badges';

type Status = keyof typeof panicStatuses | '';
type PanicAlert = z.infer<typeof panicListSchema>['items'][number];

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: '', label: 'Todas' },
  { value: 'active', label: 'Activas' },
  { value: 'confirmed', label: 'Confirmadas' },
  { value: 'resolved', label: 'Resueltas' },
];
// Primero lo que hay que atender: al ordenar por estado, las activas quedan arriba.
const STATUS_ORDER = { active: 0, confirmed: 1, resolved: 2 } as const;

const fullDate = (iso: string) => new Date(iso).toLocaleString('es-AR');
/** "24/11 11:45"; con año solo si no es el actual. La fecha completa queda en el `title`. */
function shortDate(iso: string) {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}
/** Cuánto tardó en llegar: por SMS puede ser bastante más que por la app. */
function delay(alert: PanicAlert) {
  const seconds = Math.max(
    0,
    Math.round((Date.parse(alert.receivedAt) - Date.parse(alert.triggeredAt)) / 1000),
  );
  return seconds < 60
    ? `${String(seconds)} s`
    : `${String(Math.floor(seconds / 60))} min ${String(seconds % 60)} s`;
}

export function PanicListPage() {
  const [filters, setFilters] = useState<{
    estado: Status;
    predio: string;
    pagina: number;
    porPagina: number;
  }>({ estado: '', predio: '', pagina: 1, porPagina: 10 });
  const params = new URLSearchParams({
    pagina: String(filters.pagina),
    porPagina: String(filters.porPagina),
  });
  if (filters.estado) params.set('estado', filters.estado);
  if (filters.predio) params.set('predio', filters.predio);
  const list = useQuery({
    queryKey: ['panico', 'list', filters],
    queryFn: () => apiGet(`/alertas-panico?${params}`, panicListSchema),
    refetchInterval: 15000,
  });
  const sites = useQuery({
    queryKey: ['sites'],
    queryFn: () => apiGet('/predios', z.array(z.object({ id: z.string(), name: z.string() }))),
  });
  const active = list.data?.activeCount ?? 0;
  // Se atendió lo último de la página: volver a la última que tenga alertas.
  const total = list.data?.total;
  if (total !== undefined && filters.pagina > lastPage(total, filters.porPagina)) {
    setFilters({ ...filters, pagina: lastPage(total, filters.porPagina) });
  }

  return (
    <section className="space-y-4" aria-label="Alertas de pánico">
      <PageHeader
        title="Alertas de pánico"
        description="Recibí, confirmá y resolvé las emergencias de tus predios"
      />
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="space-y-1.5">
          <span className="t-label block text-foreground" aria-hidden="true">
            Estado
          </span>
          <SegmentedFilter
            ariaLabel="Estado"
            options={STATUS_OPTIONS.map((option) =>
              // Las activas sin atender se cuentan siempre, filtre lo que filtre.
              option.value === 'active' && active > 0
                ? { ...option, label: `Activas (${String(active)})` }
                : option,
            )}
            value={filters.estado}
            onChange={(estado) => {
              setFilters((old) => ({ ...old, estado, pagina: 1 }));
            }}
            className="[&>button]:h-10"
          />
        </div>
        <div className="w-full space-y-1.5 sm:w-72">
          <Label htmlFor="panic-site">Predio</Label>
          <NativeSelect
            className="w-full"
            id="panic-site"
            value={filters.predio}
            onChange={(event) => {
              setFilters((old) => ({ ...old, predio: event.target.value, pagina: 1 }));
            }}
          >
            <NativeSelectOption value="">Todos</NativeSelectOption>
            {sites.data?.map((site) => (
              <NativeSelectOption key={site.id} value={site.id}>
                {site.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      {list.isPending ? (
        <div role="status" className="space-y-2">
          <span className="sr-only">Cargando alertas…</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : list.isError ? (
        <Alert variant="destructive">
          No se pudieron cargar las alertas.{' '}
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            Reintentar
          </Button>
        </Alert>
      ) : list.data.items.length === 0 ? (
        <EmptyState title="No hay alertas para estos filtros" />
      ) : (
        <>
          <div className="overflow-x-auto border-[1.5px] border-input">
            <DataTable
              label="Alertas de pánico"
              sortable={false}
              rows={list.data.items}
              getRowId={(alert) => alert.id}
              // Las activas se distinguen también por su sello, no solo por el fondo.
              rowClassName={(alert) => (alert.status === 'active' ? 'bg-danger-soft' : undefined)}
              columns={[
                {
                  id: 'status',
                  header: 'Estado',
                  type: 'number',
                  width: 144,
                  value: (alert) => STATUS_ORDER[alert.status],
                  cell: (alert) => (
                    <StatusBadge
                      tone={
                        alert.status === 'active'
                          ? 'danger'
                          : alert.status === 'confirmed'
                            ? 'info'
                            : 'success'
                      }
                    >
                      {panicStatuses[alert.status]}
                    </StatusBadge>
                  ),
                },
                {
                  id: 'triggered',
                  header: 'Enviada',
                  type: 'date',
                  width: 128,
                  value: (alert) => new Date(alert.triggeredAt),
                  cell: (alert) => (
                    <time
                      dateTime={alert.triggeredAt}
                      title={fullDate(alert.triggeredAt)}
                      className="tabular-nums"
                    >
                      {shortDate(alert.triggeredAt)}
                    </time>
                  ),
                },
                {
                  id: 'site',
                  header: 'Predio',
                  value: (alert) => alert.site.name,
                  cell: (alert) => (
                    <Link
                      to={`/alertas-panico/${alert.id}`}
                      className="font-semibold underline-offset-4 hover:underline"
                    >
                      {alert.site.name}
                    </Link>
                  ),
                },
                { id: 'guard', header: 'Vigilador', value: (alert) => alert.guard.name },
                {
                  id: 'delay',
                  header: 'Llegó en',
                  type: 'number',
                  align: 'right',
                  width: 112,
                  value: (alert) => Date.parse(alert.receivedAt) - Date.parse(alert.triggeredAt),
                  cell: (alert) => (
                    <span
                      title={`Recibida: ${fullDate(alert.receivedAt)}`}
                      className="tabular-nums"
                    >
                      {delay(alert)}
                    </span>
                  ),
                },
                {
                  id: 'channel',
                  header: 'Canal',
                  width: 280,
                  value: (alert) => (alert.channel === 'sms' ? 'SMS' : 'App'),
                  cell: (alert) =>
                    alert.channel === 'sms' || !alert.authenticated || alert.phoneMismatch ? (
                      <span className="flex gap-1">
                        <SmsBadges {...alert} />
                      </span>
                    ) : (
                      'App'
                    ),
                },
                {
                  id: 'open',
                  header: 'Ver alerta',
                  hideHeader: true,
                  width: 112,
                  cell: (alert) => (
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        to={`/alertas-panico/${alert.id}`}
                        aria-label={`Ver alerta de ${alert.site.name}, ${shortDate(alert.triggeredAt)}`}
                      >
                        Ver alerta
                      </Link>
                    </Button>
                  ),
                },
              ]}
            />
          </div>
          <Pagination
            page={filters.pagina}
            pageSize={filters.porPagina}
            total={list.data.total}
            shown={list.data.items.length}
            label="alertas"
            onPage={(pagina) => {
              setFilters((old) => ({ ...old, pagina }));
            }}
            onPageSize={(porPagina) => {
              setFilters((old) => ({ ...old, porPagina, pagina: 1 }));
            }}
          />
        </>
      )}
    </section>
  );
}
