import {
  SHIFT_LIST_ORDERS,
  SHIFT_LIST_STATES,
  localDateTimeToUtc,
  addDays,
  shiftBoardSchema,
  weekStart,
  type ShiftBoardCell,
  type ShiftListState,
} from '@garita/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import type { DataSort } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { SegmentedFilter } from '@/components/segmented-filter';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import { errorMessage } from '@/lib/error-message';
import { loadAvailableGuards } from '../personal/available-guards';
import { ReassignDialog } from '../supervision/reassign-dialog';
import { ShiftEditor, type ShiftEditorTarget } from './shift-form-dialog';
import {
  BOARD_FOCUS,
  calendarDate,
  type BoardFocus,
  gapAction,
  isCalendarDate,
  isEditable,
  signalMinutes,
  todayIn,
  LIST_SORT_IDS,
  shiftPageSchema,
  sitesSchema,
} from './shift-utils';
import { CoverageStrip } from './coverage-strip';
import { ShiftsBoard } from './shifts-board';
import { ShiftsList } from './shifts-list';

type View = 'planilla' | 'lista';
const FILTER_KEYS = ['predio', 'vigilador', 'estado', 'foco', 'q', 'desde', 'hasta'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
const STATE_LABELS: Record<ShiftListState, string> = {
  programado: 'Programados',
  en_curso: 'En curso',
  finalizado: 'Finalizados',
  problema: 'Con problema',
  cancelado: 'Cancelados',
};
const emptySchema = z.object({});
const cancelResponseSchema = z.looseObject({ id: z.string() });

interface CoverTarget {
  shiftId: string;
  endsAt: string;
  minutesToSignal: number | null;
  covering: boolean;
}

/**
 * Turnos: la planificación de la cobertura. La planilla muestra la semana por predio y deja a la
 * vista los huecos; la lista sirve para buscar en el historial. Todo el estado vive en la URL.
 */
export function ShiftsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const value = (key: string) => params.get(key) ?? '';
  const view: View = params.get('vista') === 'lista' ? 'lista' : 'planilla';
  const estado: ShiftListState | '' =
    value('estado') in SHIFT_LIST_STATES ? (value('estado') as ShiftListState) : '';
  const date = (key: 'semana' | 'desde' | 'hasta') =>
    isCalendarDate(value(key)) ? value(key) : '';
  const update = (changes: Record<string, string | null>, resetPage = true) => {
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        for (const [key, raw] of Object.entries(changes)) {
          if (raw) next.set(key, raw);
          else next.delete(key);
        }
        if (resetPage) next.delete('pagina');
        return next;
      },
      { replace: true },
    );
  };
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const [editor, setEditor] = useState<ShiftEditorTarget | null>(null);
  const [cover, setCover] = useState<CoverTarget | null>(null);
  const [cancelling, setCancelling] = useState<{ id: string; siteName: string } | null>(null);
  const [message, setMessage] = useState('');

  const sites = useQuery({
    queryKey: ['predios', 'activos'],
    queryFn: () => apiGet('/predios?estado=active', sitesSchema),
  });
  const guards = useQuery({ queryKey: ['personal', 'vigiladores'], queryFn: loadAvailableGuards });

  const boardQuery = new URLSearchParams();
  if (date('semana')) boardQuery.set('semana', date('semana'));
  for (const key of ['predio', 'vigilador'] as const)
    if (value(key)) boardQuery.set(key, value(key));
  const board = useQuery({
    queryKey: ['turnos', 'planilla', boardQuery.toString()],
    queryFn: () => apiGet(`/turnos/planilla?${boardQuery.toString()}`, shiftBoardSchema),
    placeholderData: keepPreviousData,
    enabled: view === 'planilla',
  });

  const positive = (raw: string, fallback: number, max: number) => {
    const number = Number(raw);
    return Number.isInteger(number) && number >= 1 && number <= max ? number : fallback;
  };
  const page = positive(value('pagina'), 1, Number.MAX_SAFE_INTEGER);
  const pageSize = positive(value('porPagina'), 25, 100);
  const orden = (SHIFT_LIST_ORDERS as readonly string[]).includes(value('orden'))
    ? value('orden')
    : 'inicio:desc';
  // Las fechas de los filtros son de la empresa, no del navegador.
  const timezone =
    board.data?.timezone ?? sites.data?.[0]?.company.timezone ?? 'America/Argentina/Buenos_Aires';
  const invertedDates = Boolean(date('desde') && date('hasta') && date('desde') > date('hasta'));
  const listQuery = new URLSearchParams({
    pagina: String(page),
    porPagina: String(pageSize),
    orden,
  });
  for (const key of ['predio', 'vigilador', 'q'] as const)
    if (value(key)) listQuery.set(key, value(key));
  if (estado) listQuery.set('estado', estado);
  if (date('desde'))
    listQuery.set('desde', localDateTimeToUtc(date('desde'), 0, timezone).toISOString());
  if (date('hasta'))
    // Hasta el último instante del día: el comienzo del siguiente menos un milisegundo.
    listQuery.set(
      'hasta',
      new Date(
        localDateTimeToUtc(addDays(date('hasta'), 1), 0, timezone).getTime() - 1,
      ).toISOString(),
    );
  const list = useQuery({
    queryKey: ['turnos', 'lista', listQuery.toString()],
    queryFn: () => apiGet(`/turnos?${listQuery.toString()}`, shiftPageSchema),
    placeholderData: keepPreviousData,
    enabled: view === 'lista' && !invertedDates,
  });
  const [sortField, sortDir] = orden.split(':');
  const sortId = Object.entries(LIST_SORT_IDS).find(([, field]) => field === sortField)?.[0];
  const sort: DataSort = sortId ? { id: sortId, dir: sortDir === 'asc' ? 'asc' : 'desc' } : null;

  const [searchInput, setSearchInput] = useState(value('q'));
  const [shownQ, setShownQ] = useState(value('q'));
  if (shownQ !== value('q')) {
    setShownQ(value('q'));
    if (value('q') !== searchInput.trim()) setSearchInput(value('q'));
  }
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

  const cancel = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/turnos/${encodeURIComponent(id)}/cancelar`, {}, emptySchema, cancelResponseSchema),
    onSuccess: async () => {
      setCancelling(null);
      setMessage('Turno cancelado.');
      await client.invalidateQueries({ queryKey: ['turnos'] });
    },
  });

  const saved = (text: string) => {
    setEditor(null);
    setMessage(text);
    void client.invalidateQueries({ queryKey: ['turnos'] });
  };
  /** Un hueco que todavía no empezó se asigna editando el turno; uno en hora, reasignándolo. */
  const coverShift = (shift: {
    id: string;
    status: string;
    startsAt: string;
    endsAt: string;
    minutesToSignal: number | null;
  }) => {
    if (gapAction(shift, now) === 'assign') setEditor({ shiftId: shift.id });
    else
      setCover({
        shiftId: shift.id,
        endsAt: shift.endsAt,
        minutesToSignal: shift.minutesToSignal,
        // "Cubrir el resto" solo cuando el vigilador se fue antes de hora.
        covering: shift.status === 'uncovered',
      });
  };
  // Lo que todavía no empezó se edita; lo demás (en curso, cerrado, cancelado) se mira en detalle.
  const openCell = (cell: ShiftBoardCell) => {
    if (isEditable(cell, now)) setEditor({ shiftId: cell.id });
    else void navigate(`/supervision/turnos/${cell.id}`);
  };

  const week = weekStart(date('semana') || (board.data?.today ?? todayIn(timezone)));
  const weekLabel = `${calendarDate(week, { day: 'numeric', month: 'short' })} – ${calendarDate(
    addDays(week, 6),
    { day: 'numeric', month: 'short', year: 'numeric' },
  )}`;
  const summary = board.data?.summary;
  const focus = value('foco') in BOARD_FOCUS ? (value('foco') as BoardFocus) : null;
  const boardFilter =
    focus || estado
      ? (cell: ShiftBoardCell) =>
          (!focus || BOARD_FOCUS[focus](cell, now)) &&
          (!estado || (SHIFT_LIST_STATES[estado] as readonly string[]).includes(cell.status))
      : undefined;
  // Cada vista cuenta solo los filtros que aplica.
  const viewKeys: readonly FilterKey[] =
    view === 'planilla'
      ? ['predio', 'vigilador', 'estado', 'foco']
      : ['predio', 'vigilador', 'estado', 'q', 'desde', 'hasta'];
  const hasFilters = viewKeys.some((key) => value(key));
  const selectClass = 'w-full sm:w-auto sm:max-w-56';

  return (
    <section className="space-y-4" aria-labelledby="shifts-title">
      <PageHeader
        id="shifts-title"
        title="Turnos"
        description="Quién cubre cada predio, día por día. Lo que pasa ahora está en En vivo."
        actions={
          <>
            <SegmentedFilter
              ariaLabel="Vista"
              options={[
                { value: 'planilla', label: 'Planilla' },
                { value: 'lista', label: 'Lista' },
              ]}
              value={view}
              onChange={(next) => {
                update({ vista: next === 'planilla' ? null : next });
              }}
            />
            <Button
              onClick={() => {
                setEditor({ siteId: value('predio') || undefined });
              }}
            >
              Nuevo turno
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filtrar turnos">
        {view === 'lista' && (
          <div className="relative w-full sm:w-60">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              aria-label="Buscar turnos"
              placeholder="Buscar predio o vigilador"
              className="pl-9"
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
              }}
            />
          </div>
        )}
        <NativeSelect
          aria-label="Predio"
          className={selectClass}
          value={value('predio')}
          onChange={(event) => {
            update({ predio: event.target.value });
          }}
        >
          <NativeSelectOption value="">Predio: todos</NativeSelectOption>
          {sites.data?.map((site) => (
            <NativeSelectOption key={site.id} value={site.id}>
              {site.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Vigilador"
          className={selectClass}
          value={value('vigilador')}
          onChange={(event) => {
            update({ vigilador: event.target.value });
          }}
        >
          <NativeSelectOption value="">Vigilador: todos</NativeSelectOption>
          {guards.data?.items.map((guard) => (
            <NativeSelectOption key={guard.id} value={guard.id}>
              {guard.firstName} {guard.lastName}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Estado"
          className={selectClass}
          value={estado}
          onChange={(event) => {
            // Estado y foco se pisan: elegir uno quita el otro.
            update({ estado: event.target.value, foco: null });
          }}
        >
          <NativeSelectOption value="">Estado: todos</NativeSelectOption>
          {Object.entries(STATE_LABELS).map(([key, label]) => (
            <NativeSelectOption key={key} value={key}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {view === 'planilla' ? (
          <div className="flex items-center gap-1" role="group" aria-label="Semana">
            <Button
              variant="outline"
              size="icon"
              aria-label="Semana anterior"
              onClick={() => {
                update({ semana: addDays(week, -7) });
              }}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span
              className="min-w-44 px-2 text-center font-semibold tabular-nums"
              aria-live="polite"
            >
              {weekLabel}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Semana siguiente"
              onClick={() => {
                update({ semana: addDays(week, 7) });
              }}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
            {value('semana') && (
              <Button
                variant="ghost"
                onClick={() => {
                  update({ semana: null });
                }}
              >
                Hoy
              </Button>
            )}
          </div>
        ) : (
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
      {view === 'planilla' && summary && (
        <CoverageStrip
          summary={summary}
          focus={focus}
          onFocus={(next) => {
            update({ foco: next === focus ? null : next, estado: null });
          }}
        />
      )}
      {message && (
        <p role="status" className="text-sm font-semibold">
          {message}
        </p>
      )}
      {view === 'planilla' ? (
        board.isPending ? (
          <BoardSkeleton />
        ) : board.isError ? (
          <LoadError what="la planilla" retry={() => void board.refetch()} />
        ) : board.data.sites.length === 0 ? (
          <EmptyState
            title="No hay predios para mostrar"
            description="Probá con otro filtro o dá de alta un predio en Gestión."
          />
        ) : (
          <ShiftsBoard
            board={board.data}
            now={now}
            filter={boardFilter}
            onOpen={openCell}
            onAction={(cell, action) => {
              if (action === 'assign') setEditor({ shiftId: cell.id });
              else coverShift(cell);
            }}
            onAdd={(siteId, day) => {
              setEditor({ siteId, date: day });
            }}
          />
        )
      ) : invertedDates ? (
        <Alert role="alert">La fecha “desde” tiene que ser anterior o igual a “hasta”.</Alert>
      ) : list.isPending ? (
        <BoardSkeleton />
      ) : list.isError ? (
        <LoadError what="los turnos" retry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title={hasFilters ? 'Ningún turno coincide con los filtros' : 'Todavía no hay turnos'}
          description={
            hasFilters ? 'Probá ampliar el período o quitar algún filtro.' : 'Creá el primero.'
          }
        />
      ) : (
        <>
          <ShiftsList
            rows={list.data.items}
            now={now}
            sort={sort}
            onSortChange={(next) => {
              update({
                orden: next ? `${LIST_SORT_IDS[next.id] ?? 'inicio'}:${next.dir}` : null,
              });
            }}
            onEdit={(shift) => {
              setEditor({ shiftId: shift.id });
            }}
            onCover={(shift) => {
              coverShift({ ...shift, minutesToSignal: signalMinutes(shift.site) });
            }}
            onCancel={(shift) => {
              cancel.reset();
              setCancelling({ id: shift.id, siteName: shift.site.name });
            }}
          />
          <Pagination
            page={page}
            pageSize={pageSize}
            total={list.data.total}
            shown={list.data.items.length}
            label="turnos"
            onPage={(next) => {
              update({ pagina: String(next) }, false);
            }}
            onPageSize={(size) => {
              update({ porPagina: String(size) });
            }}
          />
        </>
      )}
      <ShiftEditor
        target={editor}
        onClose={() => {
          setEditor(null);
        }}
        onSaved={saved}
      />
      {cover && (
        <ReassignDialog
          key={cover.shiftId}
          shiftId={cover.shiftId}
          endsAt={cover.endsAt}
          minutesToSignal={cover.minutesToSignal}
          covering={cover.covering}
          open
          onOpenChange={(open) => {
            if (!open) setCover(null);
          }}
        />
      )}
      <AlertDialog
        open={cancelling !== null}
        onOpenChange={(open) => {
          if (!open && !cancel.isPending) setCancelling(null);
        }}
      >
        <AlertDialogContent className="space-y-4">
          <AlertDialogTitle className="text-lg font-semibold">Cancelar turno</AlertDialogTitle>
          <AlertDialogDescription>
            ¿Cancelar el turno de {cancelling?.siteName}? Si tenía vigilador, se le avisa.
          </AlertDialogDescription>
          {cancel.error && (
            <Alert variant="destructive">
              {cancel.error instanceof ApiError &&
              (cancel.error.body as { code?: unknown } | null)?.code === 'SHIFT_STARTED'
                ? 'Solo se puede reasignar este turno porque ya pasó la hora de inicio.'
                : errorMessage(cancel.error)}
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="outline" disabled={cancel.isPending}>
                Volver
              </Button>
            </AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => {
                if (cancelling) cancel.mutate(cancelling.id);
              }}
            >
              Confirmar cancelación
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function BoardSkeleton() {
  return (
    <div role="status" aria-label="Cargando turnos" className="space-y-2">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

function LoadError({ what, retry }: { what: string; retry: () => void }) {
  return (
    <Alert variant="destructive">
      No se pudieron cargar {what}.{' '}
      <Button type="button" variant="outline" size="sm" onClick={retry}>
        Reintentar
      </Button>
    </Alert>
  );
}
