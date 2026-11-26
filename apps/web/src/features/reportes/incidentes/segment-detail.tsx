import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  INCIDENT_TYPE_LABELS,
  incidentReportDetailResponseSchema,
  panicReportDetailResponseSchema,
} from '@garita/shared';
import { DataTable } from '@/components/data-table';
import { Pagination } from '@/components/pagination';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { apiGet } from '@/lib/api-client';
import {
  ClassificationBadge,
  FollowUpBadge,
  SeverityBadge,
  fullDateTime,
  shortDateTime,
} from '@/features/incidentes/incident-ui';

export interface Segment {
  kind: 'incidentes' | 'panico';
  title: string;
  filters: Record<string, string>;
}

const OUTCOMES = {
  real_emergency: 'Emergencia real',
  false_alarm: 'Falsa alarma',
  test: 'Prueba',
} as const;

function IncidentRows({ query, timezone }: { query: string; timezone: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const result = useQuery({
    queryKey: ['reports', 'incidentes', 'detail', query, page, pageSize],
    queryFn: () =>
      apiGet(
        `/reportes/incidentes/detalle?${query}&page=${String(page)}&pageSize=${String(pageSize)}`,
        incidentReportDetailResponseSchema,
      ),
    placeholderData: keepPreviousData,
  });
  if (result.isPending) return <p role="status">Cargando detalle…</p>;
  if (result.isError)
    return (
      <Alert role="alert">
        No pudimos cargar el detalle.{' '}
        <Button variant="outline" onClick={() => void result.refetch()}>
          Reintentar
        </Button>
      </Alert>
    );
  return (
    <>
      <div className="overflow-x-auto border-[1.5px] border-input">
        <DataTable
          label="Incidentes del segmento"
          sortable={false}
          rows={result.data.items}
          getRowId={(row) => row.id}
          columns={[
            {
              id: 'when',
              header: 'Fecha',
              width: 110,
              cell: (row) => (
                <time
                  title={fullDateTime(new Date(row.occurredAt), timezone)}
                  className="tabular-nums"
                >
                  {shortDateTime(new Date(row.occurredAt), timezone)}
                </time>
              ),
            },
            {
              id: 'type',
              header: 'Incidente',
              cell: (row) => (
                <Link
                  to={`/incidentes/${row.id}`}
                  className="block truncate font-semibold underline-offset-4 hover:underline"
                >
                  {INCIDENT_TYPE_LABELS[row.type]}
                  <span className="block truncate text-sm font-normal text-muted-foreground">
                    {row.site.name}
                  </span>
                </Link>
              ),
            },
            {
              id: 'severity',
              header: 'Gravedad',
              width: 100,
              cell: (row) => <SeverityBadge severity={row.severity} />,
            },
            {
              id: 'state',
              header: 'Estado',
              width: 170,
              cell: (row) =>
                row.followUpStatus === 'open' ? (
                  <FollowUpBadge status="open" />
                ) : (
                  <ClassificationBadge status={row.classificationStatus} />
                ),
            },
          ]}
        />
      </div>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={result.data.total}
        shown={result.data.items.length}
        label="incidentes del segmento"
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </>
  );
}

function PanicRows({ query, timezone }: { query: string; timezone: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const result = useQuery({
    queryKey: ['reports', 'panico', 'detail', query, page, pageSize],
    queryFn: () =>
      apiGet(
        `/reportes/panico/detalle?${query}&page=${String(page)}&pageSize=${String(pageSize)}`,
        panicReportDetailResponseSchema,
      ),
    placeholderData: keepPreviousData,
  });
  if (result.isPending) return <p role="status">Cargando detalle…</p>;
  if (result.isError)
    return (
      <Alert role="alert">
        No pudimos cargar el detalle.{' '}
        <Button variant="outline" onClick={() => void result.refetch()}>
          Reintentar
        </Button>
      </Alert>
    );
  return (
    <>
      <div className="overflow-x-auto border-[1.5px] border-input">
        <DataTable
          label="Alertas del segmento"
          sortable={false}
          rows={result.data.items}
          getRowId={(row) => row.id}
          columns={[
            {
              id: 'when',
              header: 'Fecha',
              width: 110,
              cell: (row) => (
                <span className="tabular-nums">
                  {shortDateTime(new Date(row.triggeredAt), timezone)}
                </span>
              ),
            },
            {
              id: 'site',
              header: 'Predio',
              cell: (row) => (
                <Link
                  to={`/alertas-panico/${row.id}`}
                  className="font-semibold underline-offset-4 hover:underline"
                >
                  {row.site.name}
                </Link>
              ),
            },
            {
              id: 'channel',
              header: 'Canal',
              width: 90,
              cell: (row) => (row.channel === 'sms' ? 'SMS' : 'App'),
            },
            {
              id: 'outcome',
              header: 'Resultado',
              width: 150,
              cell: (row) => (row.outcome ? OUTCOMES[row.outcome] : 'Sin resolver'),
            },
          ]}
        />
      </div>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={result.data.total}
        shown={result.data.items.length}
        label="alertas del segmento"
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </>
  );
}

/** Panel lateral con los registros detrás de una barra o celda, sin perder el reporte de vista. */
export function SegmentDetail({
  segment,
  baseQuery,
  timezone,
  onClose,
}: {
  segment: Segment;
  baseQuery: Record<string, string>;
  timezone: string;
  onClose: () => void;
}) {
  const query = new URLSearchParams({ ...baseQuery, ...segment.filters }).toString();
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full gap-4 overflow-y-auto p-6 data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="p-0">
          <SheetTitle className="t-headline">{segment.title}</SheetTitle>
          <SheetDescription className="text-base">
            {segment.kind === 'incidentes' ? 'Incidentes' : 'Alertas de pánico'} del período
            elegido. Abrí uno para ver el detalle completo.
          </SheetDescription>
        </SheetHeader>
        {segment.kind === 'incidentes' ? (
          <IncidentRows key={query} query={query} timezone={timezone} />
        ) : (
          <PanicRows key={query} query={query} timezone={timezone} />
        )}
      </SheetContent>
    </Sheet>
  );
}
