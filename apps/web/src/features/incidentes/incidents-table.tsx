import {
  INCIDENT_CLASSIFICATION_LABELS,
  INCIDENT_FOLLOW_UP_LABELS,
  INCIDENT_FOLLOW_UP_STATUSES,
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_TYPE_LABELS,
  INCIDENT_TYPES,
  incidentListResponseSchema,
  type IncidentListItem,
} from '@garita/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Camera, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { DataTable, type DataSort } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { Pagination } from '@/components/pagination';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { apiGet } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  ClassificationBadge,
  FollowUpBadge,
  RowsSkeleton,
  SeverityBadge,
  fullDateTime,
  shortDateTime,
} from './incident-ui';

const FILTER_KEYS = [
  'q',
  'predio',
  'desde',
  'hasta',
  'tipo',
  'gravedad',
  'clasificacion',
  'seguimiento',
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
// Tipo y vigilador no se ordenan: el tipo quedaría en el orden del enum (en inglés).
const SORT_IDS: Record<string, string> = {
  occurred: 'fecha',
  site: 'predio',
  severity: 'gravedad',
};

function Filter({
  id,
  label,
  value,
  onChange,
  options,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
  className?: string;
}) {
  return (
    <NativeSelect
      id={id}
      aria-label={label}
      className={cn('w-full sm:w-auto', className)}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    >
      <NativeSelectOption value="">{label}: todos</NativeSelectOption>
      {options.map(([optionValue, optionLabel]) => (
        <NativeSelectOption key={optionValue} value={optionValue}>
          {optionLabel}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** Archivo de incidentes: una barra de filtros, la tabla y la paginación. Todo vive en la URL. */
export function IncidentsTable() {
  const [params, setParams] = useSearchParams();
  const value = (key: FilterKey) => params.get(key) ?? '';
  const page = Number(params.get('pagina') ?? '1') || 1;
  const pageSize = Number(params.get('porPagina') ?? '25') || 25;
  const orden = params.get('orden') ?? 'fecha:desc';
  const update = (changes: Record<string, string | number | null>, resetPage = true) => {
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        for (const [key, raw] of Object.entries(changes)) {
          const v = raw === null ? '' : String(raw);
          if (v) next.set(key, v);
          else next.delete(key);
        }
        if (resetPage) next.delete('pagina');
        return next;
      },
      { replace: true },
    );
  };
  const [searchInput, setSearchInput] = useState(value('q'));
  // Atrás/adelante cambian la URL: el campo de búsqueda la sigue.
  const [shownQ, setShownQ] = useState(value('q'));
  if (shownQ !== value('q')) {
    setShownQ(value('q'));
    setSearchInput(value('q'));
  }
  const invertedDates = Boolean(
    value('desde') && value('hasta') && value('desde') > value('hasta'),
  );
  useEffect(() => {
    const term = searchInput.trim();
    if (term === (params.get('q') ?? '')) return;
    const timer = setTimeout(() => {
      update({ q: term });
    }, 300);
    return () => {
      clearTimeout(timer);
    };
    // `update` cambia en cada render; la búsqueda solo depende del texto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const query = new URLSearchParams({
    pagina: String(page),
    porPagina: String(pageSize),
    orden,
  });
  for (const key of FILTER_KEYS) if (value(key)) query.set(key, value(key));
  const list = useQuery({
    queryKey: ['incidents', 'list', query.toString()],
    queryFn: () => apiGet(`/incidentes?${query}`, incidentListResponseSchema),
    placeholderData: keepPreviousData,
    enabled: !invertedDates,
  });
  const sites = useQuery({
    queryKey: ['sites'],
    queryFn: () => apiGet('/predios', z.array(z.looseObject({ id: z.string(), name: z.string() }))),
  });
  const [sortField, sortDir] = orden.split(':');
  const sortId = Object.entries(SORT_IDS).find(([, field]) => field === sortField)?.[0];
  const sort: DataSort = sortId ? { id: sortId, dir: sortDir === 'asc' ? 'asc' : 'desc' } : null;
  const hasFilters = FILTER_KEYS.some((key) => value(key));
  const counts = list.data?.counts;
  const timezone = list.data?.timezone ?? 'America/Argentina/Buenos_Aires';

  const chip = (label: string, count: number, key: FilterKey, chipValue: string) => {
    const active = value(key) === chipValue;
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => {
          update({ [key]: active ? null : chipValue });
        }}
        className={cn(
          'min-h-9 rounded-md border-[1.5px] px-3 text-sm font-semibold tabular-nums',
          active
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-input hover:bg-muted',
        )}
      >
        {count} {label}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div
        className="flex flex-wrap items-center gap-2"
        role="search"
        aria-label="Filtrar incidentes"
      >
        <div className="relative w-full sm:w-64">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Buscar incidentes"
            placeholder="Buscar en descripción o vigilador"
            className="pl-9"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
            }}
          />
        </div>
        <Filter
          id="incident-site"
          label="Predio"
          value={value('predio')}
          onChange={(v) => {
            update({ predio: v });
          }}
          options={(sites.data ?? []).map((site) => [site.id, site.name] as const)}
          className="sm:max-w-56"
        />
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            aria-label="Desde"
            className="w-auto"
            value={value('desde')}
            onChange={(event) => {
              update({ desde: event.target.value });
            }}
          />
          <span aria-hidden="true" className="text-muted-foreground">
            –
          </span>
          <Input
            type="date"
            aria-label="Hasta"
            className="w-auto"
            value={value('hasta')}
            onChange={(event) => {
              update({ hasta: event.target.value });
            }}
          />
        </div>
        <Filter
          id="incident-type"
          label="Tipo"
          value={value('tipo')}
          onChange={(v) => {
            update({ tipo: v });
          }}
          options={INCIDENT_TYPES.map((type) => [type, INCIDENT_TYPE_LABELS[type]] as const)}
        />
        <Filter
          id="incident-severity"
          label="Gravedad"
          value={value('gravedad')}
          onChange={(v) => {
            update({ gravedad: v });
          }}
          options={INCIDENT_SEVERITIES.map((s) => [s, INCIDENT_SEVERITY_LABELS[s]] as const)}
        />
        <Filter
          id="incident-status"
          label="Clasificación"
          value={value('clasificacion')}
          onChange={(v) => {
            update({ clasificacion: v });
          }}
          options={Object.entries(INCIDENT_CLASSIFICATION_LABELS)}
        />
        <Filter
          id="incident-follow-up"
          label="Seguimiento"
          value={value('seguimiento')}
          onChange={(v) => {
            update({ seguimiento: v });
          }}
          options={INCIDENT_FOLLOW_UP_STATUSES.map(
            (s) => [s, INCIDENT_FOLLOW_UP_LABELS[s]] as const,
          )}
        />
        {counts && (
          <div className="flex flex-wrap gap-2 lg:ml-auto">
            {chip('gravedad alta', counts.high, 'gravedad', 'high')}
            {chip('seguimiento abierto', counts.followUpOpen, 'seguimiento', 'open')}
          </div>
        )}
        {hasFilters && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearchInput('');
              update(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])));
            }}
          >
            Limpiar filtros
          </Button>
        )}
      </div>
      {invertedDates ? (
        <Alert role="alert">La fecha “desde” tiene que ser anterior o igual a “hasta”.</Alert>
      ) : list.isPending ? (
        <RowsSkeleton label="Cargando incidentes…" rows={10} />
      ) : list.isError ? (
        <Alert variant="destructive">
          No se pudieron cargar los incidentes.{' '}
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            Reintentar
          </Button>
        </Alert>
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title={
            hasFilters ? 'Ningún incidente coincide con los filtros' : 'Todavía no hay incidentes'
          }
          description={
            hasFilters
              ? 'Probá ampliar el período o quitar algún filtro.'
              : 'Cuando un vigilador reporte uno desde la app, aparece acá.'
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto border-[1.5px] border-input">
            <DataTable<IncidentListItem>
              label="Incidentes"
              rows={list.data.items}
              getRowId={(row) => row.id}
              sort={sort}
              onSortChange={(next) => {
                update(
                  { orden: next ? `${SORT_IDS[next.id] ?? 'fecha'}:${next.dir}` : null },
                  true,
                );
              }}
              rowClassName={(row) =>
                row.severity === 'high' && row.followUpStatus === 'open'
                  ? 'bg-danger-soft'
                  : undefined
              }
              columns={[
                {
                  id: 'occurred',
                  header: 'Fecha',
                  type: 'date',
                  width: 120,
                  value: (row) => row.occurredAt,
                  cell: (row) => (
                    <time
                      dateTime={row.occurredAt.toISOString()}
                      title={fullDateTime(row.occurredAt, timezone)}
                      className="tabular-nums"
                    >
                      {shortDateTime(row.occurredAt, timezone)}
                    </time>
                  ),
                },
                {
                  id: 'type',
                  header: 'Incidente',
                  cell: (row) => (
                    <span className="block min-w-0">
                      <Link
                        to={`/incidentes/${row.id}`}
                        className="block truncate font-semibold underline-offset-4 hover:underline"
                      >
                        {INCIDENT_TYPE_LABELS[row.type]}
                      </Link>
                      {row.description && (
                        <span className="block truncate text-sm text-muted-foreground">
                          {row.description}
                        </span>
                      )}
                    </span>
                  ),
                },
                { id: 'site', header: 'Predio', width: 220, value: (row) => row.site.name },
                {
                  id: 'guard',
                  header: 'Vigilador',
                  width: 170,
                  cell: (row) => <span className="truncate">{row.guardName}</span>,
                },
                {
                  id: 'severity',
                  header: 'Gravedad',
                  type: 'number',
                  width: 110,
                  value: (row) => (row.severity ? INCIDENT_SEVERITIES.indexOf(row.severity) : -1),
                  cell: (row) => <SeverityBadge severity={row.severity} />,
                },
                {
                  id: 'classification',
                  header: 'Clasificación',
                  width: 180,
                  cell: (row) => <ClassificationBadge status={row.classificationStatus} />,
                },
                {
                  id: 'followUp',
                  header: 'Seguimiento',
                  width: 130,
                  cell: (row) => <FollowUpBadge status={row.followUpStatus} />,
                },
                {
                  id: 'photos',
                  header: 'Fotos',
                  align: 'right',
                  width: 80,
                  cell: (row) =>
                    row.photoCount ? (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Camera aria-hidden="true" className="size-4" />
                        {row.photoCount}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    ),
                },
              ]}
            />
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={list.data.total}
            shown={list.data.items.length}
            label="incidentes"
            onPage={(pagina) => {
              update({ pagina }, false);
            }}
            onPageSize={(porPagina) => {
              update({ porPagina });
            }}
          />
        </>
      )}
    </div>
  );
}
