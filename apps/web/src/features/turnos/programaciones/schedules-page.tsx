import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EllipsisVertical, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { z } from 'zod';
import {
  SCHEDULE_EXPIRING_DAYS,
  SCHEDULE_LIST_STATES,
  scheduleDateOffset,
  scheduleOperationSchema,
  shiftScheduleExtensionSchema,
  shiftScheduleListSchema,
  type ScheduleListState,
  type ScheduleOperation,
  type ShiftScheduleListItem,
} from '@garita/shared';
import { DataTable } from '@/components/data-table';
import { Pagination } from '@/components/pagination';
import { PAGE_SIZES, lastPage } from '@/lib/page-items';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet, apiPost } from '@/lib/api-client';
import { errorMessage } from '@/lib/error-message';
import { cn } from '@/lib/utils';
import { loadAvailableGuards } from '../../personal/available-guards';
import { ScheduleFormDialog } from './schedule-form-dialog';
import { WEEKDAYS, WEEK_ORDER, crossesMidnight, periodLabel, shortDate } from './schedule-format';

const sitesSchema = z.array(z.looseObject({ id: z.string(), name: z.string() }));
const FILTER_KEYS = ['q', 'predio', 'vigilador', 'estado'] as const;
const STATE_LABELS: Record<ScheduleListState, string> = {
  vigente: 'Vigentes',
  por_vencer: 'Por vencer',
  finalizada: 'Finalizadas',
  cancelada: 'Canceladas',
};
type Schedule = ShiftScheduleListItem;

/** Resultado de crear, modificar, extender o cancelar: cuántos turnos se tocaron. */
export function ScheduleResult({ result }: { result: ScheduleOperation }) {
  return (
    <Alert role="status">
      Programación actualizada: {result.generated.length} turnos generados, {result.replaced.length}{' '}
      afectados y {result.conserved.length} conservados
      {result.conflicts.length > 0
        ? `; ${result.conflicts.length} no se generaron por conflicto.`
        : '.'}
    </Alert>
  );
}

/** La semana tipo de un vistazo: siete casillas, rellenas los días en que empieza el turno. */
function WeekStrip({ weekdays }: { weekdays: number[] }) {
  return (
    <span
      className="inline-grid grid-cols-7 gap-0.5"
      role="img"
      aria-label={WEEK_ORDER.filter((day) => weekdays.includes(day))
        .map((day) => WEEKDAYS[day]?.long)
        .join(', ')}
    >
      {WEEK_ORDER.map((day) => {
        const on = weekdays.includes(day);
        return (
          <span
            key={day}
            aria-hidden="true"
            className={cn(
              'grid h-7 w-8 place-items-center rounded-sm border-[1.5px] text-sm font-semibold',
              on
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-dashed border-input text-muted-foreground',
            )}
          >
            {WEEKDAYS[day]?.short.charAt(0)}
          </span>
        );
      })}
    </span>
  );
}

function Validity({ schedule }: { schedule: Schedule }) {
  const left = schedule.daysToEnd;
  const live = schedule.status === 'active' && left >= 0;
  return (
    <span className="block">
      <span className="block tabular-nums">
        {periodLabel(schedule.startDate, schedule.endDate)}
      </span>
      <span
        className={cn(
          'block text-sm',
          live && left <= SCHEDULE_EXPIRING_DAYS
            ? 'font-semibold text-warning'
            : 'text-muted-foreground',
        )}
      >
        {schedule.status === 'cancelled'
          ? 'Cancelada'
          : schedule.status === 'finished'
            ? 'Finalizada'
            : !live
              ? `Finalizó el ${shortDate(schedule.endDate)}`
              : left === 0
                ? 'Vence hoy'
                : `Vence en ${left} ${left === 1 ? 'día' : 'días'}`}
      </span>
    </span>
  );
}

/**
 * Programaciones: los patrones semanales que generan turnos. La tabla muestra qué semana tipo
 * arma cada una, hasta cuándo dura y cuántos turnos le quedan; el formulario abre a un costado.
 */
export function SchedulesPage() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const value = (key: string) => params.get(key) ?? '';
  const update = (changes: Record<string, string | null>) => {
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        // Cambiar un filtro vuelve a la primera página.
        if (!('pagina' in changes)) next.delete('pagina');
        for (const [key, raw] of Object.entries(changes)) {
          if (raw) next.set(key, raw);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  };
  // Estado de la URL validado: uno desconocido se trata como "vigentes".
  const estado = (SCHEDULE_LIST_STATES as readonly string[]).includes(value('estado'))
    ? value('estado')
    : '';
  const [searchInput, setSearchInput] = useState(value('q'));
  // Atrás/adelante cambian la URL: el campo de búsqueda la sigue.
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

  const [formTarget, setFormTarget] = useState<{ editing: Schedule | null } | null>(null);
  const [action, setAction] = useState<{ schedule: Schedule; kind: 'extend' | 'cancel' } | null>(
    null,
  );
  const [extensionEnd, setExtensionEnd] = useState('');
  const [result, setResult] = useState<ScheduleOperation | null>(null);

  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) if (value(key)) query.set(key, value(key));
  // "Vigente" es el estado por defecto y uno desconocido no se manda: la API respondería 400.
  if (!estado || estado === 'vigente') query.delete('estado');
  // Entero entre 1 y el tope de la API: otro valor en la URL respondería 400.
  const asked = Number(value('pagina'));
  const page = Number.isInteger(asked) && asked >= 1 && asked <= 100_000 ? asked : 1;
  // Un tamaño que la API no acepta respondería 400: se usa el de siempre.
  const pageSize = (PAGE_SIZES as readonly number[]).includes(Number(value('porPagina')))
    ? Number(value('porPagina'))
    : 20;
  query.set('pagina', String(page));
  query.set('porPagina', String(pageSize));
  const schedules = useQuery({
    queryKey: ['programaciones-turnos', query.toString()],
    queryFn: () =>
      apiGet(
        `/programaciones-turnos${query.size ? `?${query.toString()}` : ''}`,
        shiftScheduleListSchema,
      ),
    placeholderData: keepPreviousData,
  });
  // Se quitó lo último de la página (p. ej. una cancelación) o la URL pide una que no existe:
  // volver a la última que tenga resultados.
  const last = lastPage(schedules.data?.total ?? 0, pageSize);
  const outOfRange = Boolean(schedules.data) && !schedules.isPlaceholderData && page > last;
  useEffect(() => {
    if (outOfRange) update({ pagina: last > 1 ? String(last) : null });
    // `update` cambia en cada render; alcanza con reaccionar al rango.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outOfRange, last]);
  const sites = useQuery({
    queryKey: ['predios', 'activos'],
    queryFn: () => apiGet('/predios?estado=active', sitesSchema),
  });
  const guards = useQuery({ queryKey: ['personal', 'vigiladores'], queryFn: loadAvailableGuards });

  const refresh = async (operation: ScheduleOperation) => {
    setResult(operation);
    await client.invalidateQueries({ queryKey: ['programaciones-turnos'] });
    await client.invalidateQueries({ queryKey: ['turnos'] });
  };
  const change = useMutation({
    // Recibe todo por parámetro: no depende de lo que haya en pantalla al resolverse.
    mutationFn: (input: { id: string; kind: 'extend' | 'cancel'; endDate: string }) =>
      apiPost(
        `/programaciones-turnos/${input.id}/${input.kind === 'extend' ? 'extender' : 'cancelar'}`,
        input.kind === 'extend' ? { endDate: input.endDate } : {},
        input.kind === 'extend' ? shiftScheduleExtensionSchema : z.strictObject({}),
        scheduleOperationSchema,
      ),
    onSuccess: async (operation) => {
      setAction(null);
      await refresh(operation);
    },
  });

  // Con los valores ya validados: "vigentes" es el estado por defecto, no un filtro.
  const hasFilters =
    Boolean(value('q') || value('predio') || value('vigilador')) ||
    Boolean(estado && estado !== 'vigente');
  const expiring = schedules.data?.expiring ?? 0;
  const selectClass = 'w-full sm:w-auto sm:max-w-56';

  return (
    <section className="space-y-4" aria-labelledby="schedules-title">
      <PageHeader
        id="schedules-title"
        title="Programaciones de turnos"
        description="Las guardias que se repiten cada semana y los turnos que generan."
        actions={
          <Button
            onClick={() => {
              setResult(null);
              setFormTarget({ editing: null });
            }}
          >
            Nueva programación
          </Button>
        }
      />
      <div
        className="flex flex-wrap items-center gap-2"
        role="search"
        aria-label="Filtrar programaciones"
      >
        <div className="relative w-full sm:w-60">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Buscar programaciones"
            placeholder="Buscar predio o vigilador"
            className="pl-9"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
            }}
          />
        </div>
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
          value={estado === 'vigente' ? '' : estado}
          onChange={(event) => {
            update({ estado: event.target.value });
          }}
        >
          {Object.entries(STATE_LABELS).map(([key, label]) => (
            <NativeSelectOption key={key} value={key === 'vigente' ? '' : key}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
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
        <button
          type="button"
          aria-pressed={estado === 'por_vencer'}
          onClick={() => {
            update({ estado: estado === 'por_vencer' ? null : 'por_vencer' });
          }}
          className={cn(
            'min-h-9 rounded-md border-[1.5px] px-3 text-sm font-semibold tabular-nums lg:ml-auto',
            estado === 'por_vencer'
              ? 'border-primary bg-primary text-primary-foreground'
              : expiring > 0
                ? 'border-warning bg-warning-soft text-warning'
                : 'border-input',
          )}
        >
          {expiring} por vencer en {SCHEDULE_EXPIRING_DAYS} días
        </button>
      </div>
      {result && <ScheduleResult result={result} />}
      {schedules.isPending ? (
        <div role="status" aria-label="Cargando programaciones" className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : schedules.isError ? (
        <Alert variant="destructive">
          No se pudieron cargar las programaciones.{' '}
          <Button variant="outline" size="sm" onClick={() => void schedules.refetch()}>
            Reintentar
          </Button>
        </Alert>
      ) : schedules.data.total === 0 ? (
        <EmptyState
          title={hasFilters ? 'Ninguna programación coincide' : 'Sin programaciones vigentes'}
          description={
            hasFilters
              ? 'Probá con otro estado o quitá algún filtro.'
              : 'Creá una programación para repetir una guardia semanal.'
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto border-[1.5px] border-input">
            <DataTable<Schedule>
              label="Programaciones"
              // Paginada en el servidor: ordenar solo la página visible confunde.
              sortable={false}
              rows={schedules.data.items}
              getRowId={(row) => row.id}
              rowClassName={(row) =>
                row.status === 'active' &&
                row.daysToEnd >= 0 &&
                row.daysToEnd <= SCHEDULE_EXPIRING_DAYS
                  ? 'bg-warning-soft'
                  : undefined
              }
              columns={[
                {
                  id: 'site',
                  header: 'Predio y vigilador',
                  width: 260,
                  value: (row) => row.siteName,
                  cell: (row) => (
                    <span className="block min-w-0">
                      <span className="block truncate font-semibold">{row.siteName}</span>
                      <span className="block truncate text-muted-foreground">{row.guardName}</span>
                    </span>
                  ),
                },
                {
                  id: 'week',
                  header: 'Semana tipo',
                  width: 300,
                  cell: (row) => <WeekStrip weekdays={row.weekdays} />,
                },
                {
                  id: 'time',
                  header: 'Horario',
                  width: 160,
                  value: (row) => row.startTime,
                  cell: (row) => (
                    <span className="t-numeral whitespace-nowrap">
                      {row.startTime} → {row.endTime}
                      {crossesMidnight(row.startTime, row.endTime) && (
                        <abbr
                          title="Termina al día siguiente"
                          className="ml-1 text-sm no-underline"
                        >
                          +1
                        </abbr>
                      )}
                    </span>
                  ),
                },
                {
                  id: 'validity',
                  header: 'Vigencia',
                  type: 'number',
                  width: 200,
                  value: (row) => row.daysToEnd,
                  cell: (row) => <Validity schedule={row} />,
                },
                {
                  id: 'shifts',
                  header: 'Turnos',
                  type: 'number',
                  width: 140,
                  value: (row) => row.upcomingCount,
                  cell: (row) => (
                    <span className="block">
                      <span className="block tabular-nums">{row.upcomingCount} próximos</span>
                      {row.modifiedCount > 0 && (
                        <span className="block text-sm text-muted-foreground tabular-nums">
                          {row.modifiedCount} editados a mano
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  id: 'rounds',
                  header: 'Rondas',
                  cell: (row) => (
                    <span className="block truncate">{row.roundNames.join(', ')}</span>
                  ),
                },
                {
                  id: 'actions',
                  header: 'Acciones',
                  hideHeader: true,
                  width: 64,
                  align: 'right',
                  cell: (row) =>
                    row.status === 'active' && row.daysToEnd >= 0 ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Acciones de la programación de ${row.siteName}`}
                          >
                            <EllipsisVertical aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-auto">
                          <DropdownMenuItem
                            onSelect={() => {
                              setResult(null);
                              setFormTarget({ editing: row });
                            }}
                          >
                            Modificar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              change.reset();
                              setExtensionEnd('');
                              setAction({ schedule: row, kind: 'extend' });
                            }}
                          >
                            Extender
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                              change.reset();
                              setAction({ schedule: row, kind: 'cancel' });
                            }}
                          >
                            Cancelar programación
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null,
                },
              ]}
            />
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={schedules.data.total}
            shown={schedules.data.items.length}
            label="programaciones"
            onPage={(next) => {
              update({ pagina: next > 1 ? String(next) : null });
            }}
            onPageSize={(size) => {
              update({ porPagina: size === 20 ? null : String(size) });
            }}
          />
        </div>
      )}
      <ScheduleFormDialog
        open={formTarget !== null}
        editing={formTarget?.editing ?? null}
        onClose={() => {
          setFormTarget(null);
        }}
        onSaved={(operation) => {
          setFormTarget(null);
          void refresh(operation);
        }}
      />
      <Dialog
        open={Boolean(action)}
        onOpenChange={(open) => {
          if (!open && !change.isPending) setAction(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {action?.kind === 'extend' ? 'Extender programación' : 'Cancelar programación'}
          </DialogTitle>
          <DialogDescription>
            {action?.kind === 'extend'
              ? `${action.schedule.siteName} · ${action.schedule.guardName}. Se agregan turnos desde el ${shortDate(scheduleDateOffset(action.schedule.endDate, 1))}, hasta tres meses más.`
              : `${action?.schedule.siteName ?? ''} · ${action?.schedule.guardName ?? ''}. Se cancelan los ${action?.schedule.upcomingCount ?? 0} turnos próximos; los realizados se conservan.`}
          </DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (action)
                change.mutate({
                  id: action.schedule.id,
                  kind: action.kind,
                  endDate: extensionEnd,
                });
            }}
            className="mt-4 space-y-4"
          >
            {action?.kind === 'extend' && (
              <div className="space-y-1.5">
                <Label htmlFor="extension-end">Nueva fecha final incluida</Label>
                <Input
                  id="extension-end"
                  type="date"
                  required
                  min={scheduleDateOffset(action.schedule.endDate, 1)}
                  value={extensionEnd}
                  onChange={(event) => {
                    setExtensionEnd(event.target.value);
                  }}
                />
              </div>
            )}
            {change.error && <Alert variant="destructive">{errorMessage(change.error)}</Alert>}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={change.isPending}
                onClick={() => {
                  setAction(null);
                }}
              >
                Volver
              </Button>
              <Button
                type="submit"
                variant={action?.kind === 'cancel' ? 'destructive' : 'default'}
                disabled={change.isPending}
              >
                {change.isPending ? 'Confirmando…' : 'Confirmar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
