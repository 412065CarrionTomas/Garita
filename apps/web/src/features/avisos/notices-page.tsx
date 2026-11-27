import { Link, useSearchParams } from 'react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { noticeSchema } from '@garita/shared';
import { NOTICE_KINDS, NOTICE_STATUSES, noticesListResponseSchema } from '@garita/shared';
import { z } from 'zod';
import { apiGet } from '@/lib/api-client';
import { DataTable } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Pagination } from '@/components/pagination';
import { SegmentedFilter } from '@/components/segmented-filter';
import { StatusBadge } from '@/components/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { lastPage } from '@/lib/page-items';
import { noticeLabels, noticeTone, resolutionLabels } from './labels';

type Notice = z.infer<typeof noticeSchema>;
type Status = 'open' | 'resolved' | '';

const detailsSchema = z.object({
  missingPoints: z.array(z.string()).optional(),
  occurredAt: z.iso.datetime().optional(),
  closedAt: z.iso.datetime().optional(),
  reason: z.string().nullable().optional(),
  closedByName: z.string().nullable().optional(),
  startsAt: z.iso.datetime().optional(),
});
const details = (notice: Notice) => {
  const parsed = detailsSchema.safeParse(notice.details);
  return parsed.success ? parsed.data : null;
};
const occurredAt = (notice: Notice) => {
  const d = details(notice);
  return d?.occurredAt ?? d?.closedAt ?? notice.createdAt;
};
const hour = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
/** Lo que explica el aviso en una línea, según su tipo; resuelto, cómo se resolvió. */
function summary(notice: Notice): string {
  if (notice.status === 'resolved')
    return `Resuelto: ${notice.resolution ? resolutionLabels[notice.resolution] : 'sin motivo registrado'}`;
  const d = details(notice);
  switch (notice.kind) {
    case 'round_missed':
      return d?.missingPoints?.length
        ? `Faltan: ${d.missingPoints.join(', ')}`
        : 'No se registró la ronda';
    case 'shift_not_started':
      return `Debía empezar a las ${hour(d?.startsAt ?? notice.shift.startsAt)} y no hay inicio`;
    case 'shift_unsynced':
      return `Terminó a las ${hour(notice.shift.endsAt)} y faltan sus datos`;
    case 'shift_without_guard':
      return 'No tiene vigilador asignado';
    case 'shift_closed_early':
      return [
        d?.closedAt ? `Cerrado a las ${hour(d.closedAt)}` : 'Cerrado antes de hora',
        d?.closedByName ? `por ${d.closedByName}` : '',
        d?.reason ? `: ${d.reason}` : '',
      ]
        .filter(Boolean)
        .join(' ')
        .replace(' :', ':');
  }
}
/** "25/11 08:00–16:00" si termina el mismo día; si no, "25/11 22:00 – 26/11 06:00". */
function shiftRange(startsAt: string, endsAt: string) {
  const sameDay = new Date(startsAt).toDateString() === new Date(endsAt).toDateString();
  return sameDay
    ? `${shortDate(startsAt)}–${hour(endsAt)}`
    : `${shortDate(startsAt)} – ${shortDate(endsAt)}`;
}
const fullDate = (iso: string) => new Date(iso).toLocaleString('es-AR');
/** "24/11 09:36"; con año solo si no es el actual. */
function shortDate(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}
const STATUS_ORDER = { open: 0, resolved: 1 } as const;

// Lo que venga en la URL se valida: un valor inválido haría fallar el pedido a la API.
const urlFiltersSchema = z.object({
  estado: z.enum(NOTICE_STATUSES).or(z.literal('')).catch('open'),
  tipo: z.enum(NOTICE_KINDS).or(z.literal('')).catch(''),
  predio: z.string().catch(''),
});
function filtersFromUrl(search: URLSearchParams) {
  const url = urlFiltersSchema.parse(Object.fromEntries(search));
  const kind: string = url.tipo;
  return {
    status: url.estado,
    kind,
    siteId: url.predio,
    page: 1,
    pageSize: 10,
  };
}

export function NoticesPage() {
  // Se puede llegar filtrado desde otras pantallas (ej. /avisos?tipo=shift_unsynced).
  const [search] = useSearchParams();
  const [filters, setFilters] = useState(() => filtersFromUrl(search));
  // Si cambia la URL con la pantalla abierta (otro enlace, atrás/adelante), se toman sus filtros.
  const [shownUrl, setShownUrl] = useState(search.toString());
  const urlChanged = shownUrl !== search.toString();
  if (urlChanged) {
    setShownUrl(search.toString());
    setFilters(filtersFromUrl(search));
  }
  const update = (change: Partial<typeof filters>) => {
    setFilters((old) => ({ ...old, page: 1, ...change }));
  };
  const params = new URLSearchParams();
  if (filters.status) params.set('estado', filters.status);
  if (filters.kind) params.set('tipo', filters.kind);
  if (filters.siteId) params.set('predio', filters.siteId);
  params.set('pagina', String(filters.page));
  params.set('porPagina', String(filters.pageSize));
  const notices = useQuery({
    queryKey: ['avisos', 'list', filters],
    queryFn: () => apiGet(`/avisos?${params}`, noticesListResponseSchema),
  });
  const sites = useQuery({
    queryKey: ['sites'],
    queryFn: () => apiGet('/predios', z.array(z.object({ id: z.string(), name: z.string() }))),
  });
  const open = notices.data?.openCount ?? 0;
  // Se resolvió lo último de la página (ej. en vivo): volver a la última que tenga avisos.
  const total = notices.data?.total;
  // Si además cambió la URL, manda la URL (y `total` es de los filtros anteriores).
  if (!urlChanged && total !== undefined && filters.page > lastPage(total, filters.pageSize)) {
    setFilters({ ...filters, page: lastPage(total, filters.pageSize) });
  }

  return (
    <section aria-labelledby="notices-title" className="space-y-4">
      <PageHeader
        id="notices-title"
        title="Avisos"
        description="Avisos de tus predios y su historial de resolución."
      />
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="space-y-1.5">
          <span className="t-label block text-foreground" aria-hidden="true">
            Estado
          </span>
          <SegmentedFilter<Status>
            ariaLabel="Estado"
            options={[
              // Los abiertos se cuentan siempre, filtre lo que filtre.
              { value: 'open', label: open > 0 ? `Abiertos (${String(open)})` : 'Abiertos' },
              { value: 'resolved', label: 'Resueltos' },
              { value: '', label: 'Todos' },
            ]}
            value={filters.status}
            onChange={(status) => {
              update({ status });
            }}
            className="[&>button]:h-10"
          />
        </div>
        <div className="w-full space-y-1.5 sm:w-64">
          <Label htmlFor="notice-kind">Tipo</Label>
          <NativeSelect
            className="w-full"
            id="notice-kind"
            value={filters.kind}
            onChange={(e) => {
              update({ kind: e.target.value });
            }}
          >
            <NativeSelectOption value="">Todos los tipos</NativeSelectOption>
            {NOTICE_KINDS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {noticeLabels[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="w-full space-y-1.5 sm:w-72">
          <Label htmlFor="notice-site">Predio</Label>
          <NativeSelect
            className="w-full"
            id="notice-site"
            value={filters.siteId}
            disabled={sites.isPending || sites.isError}
            onChange={(e) => {
              update({ siteId: e.target.value });
            }}
          >
            <NativeSelectOption value="">Todos los predios</NativeSelectOption>
            {sites.data?.map((site) => (
              <NativeSelectOption key={site.id} value={site.id}>
                {site.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      {sites.isError && (
        <Alert variant="destructive">
          No pudimos cargar los predios.{' '}
          <Button variant="outline" size="sm" onClick={() => void sites.refetch()}>
            Reintentar
          </Button>
        </Alert>
      )}
      {notices.isPending ? (
        <div role="status" className="space-y-2">
          <span className="sr-only">Cargando avisos…</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : notices.isError ? (
        <Alert variant="destructive">
          No pudimos cargar los avisos.{' '}
          <Button variant="outline" size="sm" onClick={() => void notices.refetch()}>
            Reintentar
          </Button>
        </Alert>
      ) : notices.data.items.length === 0 ? (
        <EmptyState title="No hay avisos para estos filtros" />
      ) : (
        <>
          <div className="overflow-x-auto border-[1.5px] border-input">
            <DataTable
              label="Avisos"
              sortable={false}
              rows={notices.data.items}
              getRowId={(notice) => notice.id}
              columns={[
                {
                  id: 'status',
                  header: 'Estado',
                  type: 'number',
                  width: 136,
                  value: (notice) => STATUS_ORDER[notice.status],
                  cell: (notice) => (
                    <StatusBadge
                      tone={notice.status === 'open' ? noticeTone[notice.kind] : 'success'}
                    >
                      {notice.status === 'open' ? 'Abierto' : 'Resuelto'}
                    </StatusBadge>
                  ),
                },
                {
                  id: 'kind',
                  header: 'Aviso',
                  width: 280,
                  value: (notice) => noticeLabels[notice.kind],
                  // Los no vistos van en negrita y con la marca "Nuevo" (no solo el peso).
                  cell: (notice) => (
                    <Link
                      to={`/avisos/${encodeURIComponent(notice.id)}`}
                      className={cn(
                        'underline-offset-4 hover:underline',
                        !notice.seenAt && 'font-semibold',
                      )}
                    >
                      {noticeLabels[notice.kind]}
                      {!notice.seenAt && <span className="t-label ml-2 text-info">Nuevo</span>}
                    </Link>
                  ),
                },
                { id: 'site', header: 'Predio', value: (notice) => notice.site.name },
                {
                  id: 'detail',
                  header: 'Detalle',
                  value: summary,
                  cell: (notice) => (
                    <span className="text-muted-foreground">{summary(notice)}</span>
                  ),
                },
                {
                  id: 'shift',
                  header: 'Turno',
                  type: 'date',
                  width: 248,
                  value: (notice) => new Date(notice.shift.startsAt),
                  cell: (notice) => (
                    <span
                      className="tabular-nums"
                      title={`${fullDate(notice.shift.startsAt)} – ${fullDate(notice.shift.endsAt)}`}
                    >
                      {shiftRange(notice.shift.startsAt, notice.shift.endsAt)}
                    </span>
                  ),
                },
                {
                  id: 'event',
                  header: 'Evento',
                  type: 'date',
                  width: 128,
                  value: (notice) => new Date(occurredAt(notice)),
                  cell: (notice) => (
                    <time
                      dateTime={occurredAt(notice)}
                      title={`Evento: ${fullDate(occurredAt(notice))} · Recibido: ${fullDate(notice.createdAt)}`}
                      className="tabular-nums"
                    >
                      {shortDate(occurredAt(notice))}
                    </time>
                  ),
                },
              ]}
            />
          </div>
          <Pagination
            page={filters.page}
            pageSize={filters.pageSize}
            total={notices.data.total ?? notices.data.items.length}
            shown={notices.data.items.length}
            label="avisos"
            onPage={(page) => {
              setFilters((old) => ({ ...old, page }));
            }}
            onPageSize={(pageSize) => {
              update({ pageSize });
            }}
          />
        </>
      )}
    </section>
  );
}
