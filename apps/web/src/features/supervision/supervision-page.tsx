import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { apiGet } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { SegmentedFilter } from '@/components/segmented-filter';
import { StatusBadge } from '@/components/status-badge';
import { WindowBar } from '@/components/window-bar';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LiveMap } from '../mapa/live-map';
import type { LiveMapSite } from '../mapa/live-map';
import {
  isCompleteWindow,
  shiftLabels,
  shiftListSchema,
  shiftTones,
  syncLabel,
  time,
  windowBoxes,
} from './contracts';
import type { ShiftRow } from './contracts';
import { LiveLayout } from './live-layout';
import { useSiteCoordinates } from './use-site-coordinates';

type Filter = 'all' | 'late' | 'off';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'late', label: 'Tardías' },
  { value: 'off', label: 'Sin señal' },
];

const isLate = (row: ShiftRow) => (row.windows.late ?? 0) > 0;
const isOff = (row: ShiftRow) =>
  row.syncStatus?.status === 'sin_contacto' || row.syncStatus?.status === 'esperando_hasta';
const matches: Record<Filter, (row: ShiftRow) => boolean> = {
  all: () => true,
  late: isLate,
  off: isOff,
};

const guardName = (row: ShiftRow) =>
  row.assignment?.guard
    ? `${row.assignment.guard.firstName} ${row.assignment.guard.lastName}`
    : 'Sin vigilador asignado';

// TODO(foja): la lista no trae puntos hechos/total ni la demora en minutos; hoy el sello del
// predio cuenta ventanas completas y "Tardía" sale de que haya ventanas atrasadas.
function windowCount(row: ShiftRow) {
  const entries = Object.entries(row.windows);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const done = entries.reduce(
    (sum, [status, count]) => sum + (isCompleteWindow(status) ? count : 0),
    0,
  );
  return { done, total };
}

function RowsSkeleton() {
  return (
    <div role="status" aria-label="Cargando turnos" className="space-y-px">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-16 rounded-none" />
      ))}
    </div>
  );
}

export function SupervisionPage() {
  const [filter, setFilter] = useState<Filter>('all');
  // Por turno, no por predio: un predio puede tener varios turnos en la lista.
  const [hovered, setHovered] = useState<string | null>(null);
  const navigate = useNavigate();
  const coordinates = useSiteCoordinates();
  const {
    data: rows = [],
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['supervision', 'turnos'],
    queryFn: () => apiGet('/supervision/turnos', shiftListSchema),
  });
  const visible = useMemo(() => rows.filter(matches[filter]), [rows, filter]);

  // Un marcador por predio; si tiene varios turnos, gana el que está en curso.
  const { sites, shiftBySite } = useMemo(() => {
    const bySite = new Map<string, ShiftRow>();
    for (const row of visible) {
      const known = bySite.get(row.site.id);
      if (!known || (known.status !== 'in_progress' && row.status === 'in_progress'))
        bySite.set(row.site.id, row);
    }
    const list: LiveMapSite[] = [];
    for (const [siteId, row] of bySite) {
      const at = coordinates.get(siteId);
      if (!at) continue;
      const { done, total } = windowCount(row);
      list.push({
        id: siteId,
        name: row.site.name,
        ...at,
        label: total ? `${done}/${total}` : '–',
        description: `${done} de ${total} ventanas completas`,
        state: isOff(row) ? 'off' : isLate(row) ? 'late' : 'normal',
      });
    }
    return { sites: list, shiftBySite: bySite };
  }, [visible, coordinates]);

  const panel = (
    <>
      <div className="space-y-3 px-5 pt-4 pb-3">
        <PageHeader
          id="supervision-title"
          title="En vivo"
          description={`${rows.length} ${rows.length === 1 ? 'turno' : 'turnos'} de hoy, actualizado automáticamente.`}
        />
        <SegmentedFilter
          ariaLabel="Filtrar rondas"
          options={FILTERS}
          value={filter}
          onChange={setFilter}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-input">
        {isPending ? (
          <RowsSkeleton />
        ) : isError ? (
          <Alert variant="destructive" role="alert" className="m-5 w-auto">
            No pudimos cargar los turnos.{' '}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => void refetch()}
            >
              Reintentar
            </button>
          </Alert>
        ) : rows.length === 0 ? (
          <EmptyState
            className="m-5"
            title="Sin turnos en curso"
            description="Cuando empiece un turno, lo vas a ver acá con su ronda y sus ventanas."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            className="m-5"
            title="Sin rondas en este estado"
            description="Probá con otro filtro."
          />
        ) : (
          <Table aria-label="Turnos en vivo">
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="hover:bg-muted">
                <TableHead>Predio y vigilador</TableHead>
                <TableHead>Ventanas</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => {
                const sync = syncLabel(row.syncStatus);
                return (
                  <TableRow
                    key={row.id}
                    data-state={hovered === row.id ? 'selected' : undefined}
                    className="relative"
                    onMouseEnter={() => {
                      setHovered(row.id);
                    }}
                    onMouseLeave={() => {
                      setHovered(null);
                    }}
                  >
                    <TableCell className="h-16 whitespace-normal">
                      <Link
                        to={`/supervision/turnos/${row.id}`}
                        className="font-semibold after:absolute after:inset-0"
                      >
                        {row.site.name}
                      </Link>
                      <p className="text-sm text-muted-foreground tabular-nums">
                        {time(row.startsAt)}–{time(row.endsAt)} · {guardName(row)}
                      </p>
                      {sync && <p className="text-sm text-muted-foreground">{sync}</p>}
                    </TableCell>
                    <TableCell>
                      {Object.keys(row.windows).length ? (
                        <WindowBar windows={windowBoxes(row.windows)} />
                      ) : (
                        <span aria-label="Sin ventanas" className="text-muted-foreground">
                          —
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge tone={shiftTones[row.status]}>
                          {shiftLabels[row.status]}
                        </StatusBadge>
                        {row.status === 'in_progress' && isLate(row) && (
                          <StatusBadge tone="warning">Tardía</StatusBadge>
                        )}
                        {row.status === 'in_progress' && isOff(row) && (
                          <StatusBadge tone="neutral">Sin señal</StatusBadge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );

  return (
    <LiveLayout
      labelledBy="supervision-title"
      panel={panel}
      map={
        <LiveMap
          sites={sites}
          hoveredSiteId={visible.find((row) => row.id === hovered)?.site.id ?? null}
          onHoverSite={(siteId) => {
            setHovered(siteId ? (shiftBySite.get(siteId)?.id ?? null) : null);
          }}
          onSelectSite={(siteId) => {
            const shift = shiftBySite.get(siteId);
            if (shift) void navigate(`/supervision/turnos/${shift.id}`);
          }}
        />
      }
    />
  );
}
