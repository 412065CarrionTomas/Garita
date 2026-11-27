/* eslint react-refresh/only-export-components: off */
import { useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import { useFillHeight } from '@/lib/use-fill-height';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SegmentedFilter } from '@/components/segmented-filter';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { isCalendarDate } from '../turnos/shift-utils';
import { FlagChip, ReviewDetail } from './review-detail';
import {
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  countSchema,
  flagSeverity,
  sitesSchema,
  dayTime,
  elapsed,
  flagLabel,
  queueSchema,
  type QueueItem,
} from './review-contracts';

type Estado = 'pendientes' | 'resueltas';

function useReviewQueue(filters: Record<string, string>, enabled: boolean) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  return useQuery({
    queryKey: ['revision', 'queue', query.toString()],
    queryFn: () => apiGet(`/ventanas-ronda/en-revision?${query.toString()}`, queueSchema),
    enabled,
    refetchInterval: 30_000,
  });
}

/** Contador de la barra: pide solo la cifra, no arma la bandeja en cada sondeo. */
export function useReviewCount(enabled: boolean) {
  return useQuery({
    queryKey: ['revision', 'count'],
    queryFn: () => apiGet('/ventanas-ronda/en-revision/cantidad', countSchema),
    enabled,
    refetchInterval: 30_000,
  });
}

/**
 * Una ventana de la bandeja en tres renglones: qué ronda y cuánto espera, dónde y quién, y qué
 * marcas tiene (por nombre, que es lo que hace falta para decidir).
 */
function QueueRow({
  item,
  timezone,
  selected,
  onSelect,
}: {
  item: QueueItem;
  timezone: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const types = [...item.flags.types].sort(
    (a, b) => SEVERITY_ORDER[flagSeverity(a)] - SEVERITY_ORDER[flagSeverity(b)],
  );
  // La gravedad de la ventana (la misma que usa el filtro), no la de un tipo de marca.
  const worst = item.severityLevel;
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
        className={cn(
          'block w-full space-y-1.5 border-b border-l-4 border-b-border px-4 py-3 text-left hover:bg-muted',
          worst === 'grave'
            ? 'border-l-danger'
            : worst === 'media'
              ? 'border-l-warning'
              : 'border-l-transparent',
          selected && 'bg-muted ring-2 ring-primary ring-inset',
        )}
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-lg font-semibold">
            {item.round.name} · v{item.windowIndex + 1}
          </span>
          {item.resolution ? (
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
              {dayTime(item.resolution.decidedAt, timezone)}
            </span>
          ) : (
            item.inReviewSince && (
              <span
                className={cn(
                  'shrink-0 rounded-sm px-1.5 text-sm font-semibold tabular-nums',
                  item.overdue ? 'bg-warning-soft text-warning' : 'bg-muted text-muted-foreground',
                )}
              >
                hace {elapsed(item.inReviewSince)}
                {item.overdue && <span className="sr-only"> (más de 24 h)</span>}
              </span>
            )
          )}
        </span>
        <span className="block truncate text-muted-foreground">
          <span className="font-semibold text-foreground">{item.guardName ?? 'Sin vigilador'}</span>
          {' · '}
          <span className="tabular-nums">{dayTime(item.startsAt, timezone)}</span> ·{' '}
          {item.shift.site.name}
        </span>
        <span className="flex flex-wrap gap-1.5 text-sm">
          {item.resolution ? (
            <span>
              <span className="font-semibold">
                {item.resolution.kind === 'validate' ? 'Validada' : 'Recalculada'}
              </span>{' '}
              por {item.resolution.decidedBy}
            </span>
          ) : types.length ? (
            types.map((type) => (
              <FlagChip key={type} severity={flagSeverity(type)}>
                {flagLabel(type).label}
              </FlagChip>
            ))
          ) : (
            <span className="text-muted-foreground">Sin marcas vigentes</span>
          )}
        </span>
      </button>
    </li>
  );
}

/**
 * Bandeja de revisión de rondas: a la izquierda las ventanas con marcas graves, a la derecha la
 * elegida con la evidencia y la decisión. `/revision/:id` abre una ventana puntual (avisos).
 */
export function ReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const estado: Estado = params.get('estado') === 'resueltas' ? 'resueltas' : 'pendientes';
  const search = params.get('q') ?? '';
  const site = params.get('predio') ?? '';
  const severity = params.get('gravedad') ?? '';
  // Una fecha mal escrita en la URL se ignora; un rango invertido se avisa sin consultar.
  const date = (key: string) => {
    const value = params.get(key) ?? '';
    return isCalendarDate(value) ? value : '';
  };
  const desde = date('desde');
  const hasta = date('hasta');
  const invertedDates = Boolean(desde && hasta && desde > hasta);
  const [message, setMessage] = useState('');
  const [measure, height] = useFillHeight<HTMLDivElement>(16, 520);
  const queue = useReviewQueue({ estado, predio: site, desde, hasta }, !invertedDates);
  const siteOptions = useQuery({
    // Todos, no solo activos: puede haber ventanas resueltas de un predio dado de baja.
    queryKey: ['predios', 'todos'],
    queryFn: () => apiGet('/predios', sitesSchema),
  });
  const hasFilters = Boolean(search || site || severity || desde || hasta);
  const clearFilters = () => {
    setParams(estado === 'resueltas' ? { estado } : {}, { replace: true });
  };
  const setParam = (key: string, value: string) => {
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };
  const select = (next: string | undefined) => {
    void navigate(
      { pathname: next ? `/revision/${next}` : '/revision', search: params.toString() },
      { replace: true },
    );
  };

  const all = useMemo(() => queue.data?.items ?? [], [queue.data]);
  const sites = siteOptions.data ?? [];
  const term = search.trim().toLocaleLowerCase('es');
  // El predio y las fechas los filtra la API; la búsqueda y la gravedad, sobre lo que llegó.
  const items = all.filter(
    (item) =>
      (!severity || item.severityLevel === severity) &&
      (!term ||
        [item.round.name, item.shift.site.name, item.guardName ?? ''].some((text) =>
          text.toLocaleLowerCase('es').includes(term),
        )),
  );
  // Sin ventana en la URL se abre la primera; una de la URL se respeta aunque no esté en la lista.
  const selectedId = id ?? items[0]?.id;

  const data = queue.data;
  return (
    <section className="space-y-4" aria-labelledby="review-title">
      <PageHeader
        id="review-title"
        title="Rondas en revisión"
        description="Rondas con marcas graves: decidí con la evidencia si cuentan para el cumplimiento."
      />
      <div
        role="search"
        aria-label="Filtrar ventanas"
        className="flex flex-wrap items-center gap-2"
      >
        <SegmentedFilter<Estado>
          ariaLabel="Estado"
          value={estado}
          onChange={(value) => {
            // Cambiar de lista suelta la ventana elegida y los filtros.
            void navigate(value === 'resueltas' ? '/revision?estado=resueltas' : '/revision', {
              replace: true,
            });
          }}
          options={[
            { value: 'pendientes', label: `Pendientes${data ? ` (${String(data.count)})` : ''}` },
            { value: 'resueltas', label: 'Resueltas' },
          ]}
        />
        <div className="relative w-full sm:w-56">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Buscar ventanas"
            placeholder="Ronda, predio o vigilador"
            className="pl-9"
            value={search}
            onChange={(event) => {
              setParam('q', event.target.value);
            }}
          />
        </div>
        <NativeSelect
          aria-label="Predio"
          className="w-full sm:w-auto sm:max-w-48"
          value={site}
          onChange={(event) => {
            setParam('predio', event.target.value);
          }}
        >
          <NativeSelectOption value="">Predio: todos</NativeSelectOption>
          {sites.map((option) => (
            <NativeSelectOption key={option.id} value={option.id}>
              {option.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Gravedad"
          className="w-full sm:w-auto"
          value={severity}
          onChange={(event) => {
            setParam('gravedad', event.target.value);
          }}
        >
          <NativeSelectOption value="">Gravedad: todas</NativeSelectOption>
          {(['grave', 'media', 'leve'] as const).map((s) => (
            <NativeSelectOption key={s} value={s}>
              {SEVERITY_LABELS[s]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {/* Fechas de la ronda; en Resueltas, sin fechas se ven los últimos 30 días. */}
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            aria-label="Rondas desde"
            title="Rondas desde"
            className="w-auto"
            value={desde}
            max={hasta || undefined}
            onChange={(event) => {
              setParam('desde', event.target.value);
            }}
          />
          <span aria-hidden="true" className="text-muted-foreground">
            –
          </span>
          <Input
            type="date"
            aria-label="Rondas hasta"
            title="Rondas hasta"
            className="w-auto"
            value={hasta}
            min={desde || undefined}
            onChange={(event) => {
              setParam('hasta', event.target.value);
            }}
          />
          {(desde || hasta) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setParams(
                  (old) => {
                    const next = new URLSearchParams(old);
                    next.delete('desde');
                    next.delete('hasta');
                    return next;
                  },
                  { replace: true },
                );
              }}
            >
              Quitar fechas
            </Button>
          )}
        </div>
        {data && (
          <p className="text-base text-muted-foreground lg:ml-auto">
            <span
              className={cn('font-semibold', data.overdue > 0 ? 'text-warning' : 'text-foreground')}
            >
              {data.overdue}
            </span>{' '}
            con más de 24 h ·{' '}
            <span className="font-semibold text-foreground">{data.resolvedLastDay}</span> resueltas
            en 24 h
          </p>
        )}
      </div>
      <p role="status" aria-live="polite" className={cn('text-base', !message && 'sr-only')}>
        {message && <>Listo: {message}</>}
      </p>
      {/* Deshabilitada por fechas invertidas sigue 'pending': no mostrar carga eterna. */}
      {!invertedDates && queue.isPending && (
        <div role="status" className="space-y-2">
          <span className="sr-only">Cargando ventanas…</span>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {invertedDates && (
        <Alert variant="destructive" role="alert">
          La fecha &quot;desde&quot; tiene que ser anterior o igual a &quot;hasta&quot;.
        </Alert>
      )}
      {data?.truncated && (
        <p className="text-base text-warning">
          Se muestran las primeras 200 ventanas. Acotá con fechas o predio para ver el resto.
        </p>
      )}
      {queue.isError && (
        <Alert variant="destructive">
          No pudimos cargar las ventanas.{' '}
          <Button variant="outline" size="sm" onClick={() => void queue.refetch()}>
            Reintentar
          </Button>
        </Alert>
      )}
      {data && !invertedDates && !selectedId && (
        <EmptyState
          action={
            hasFilters ? (
              <Button variant="outline" onClick={clearFilters}>
                Limpiar filtros
              </Button>
            ) : undefined
          }
          title={
            all.length === 0 && !hasFilters
              ? estado === 'pendientes'
                ? 'No hay rondas en revisión'
                : 'No se resolvió ninguna ventana en los últimos 30 días'
              : 'Ninguna ventana coincide con los filtros'
          }
          description={
            all.length === 0 && estado === 'pendientes'
              ? 'Cuando una ronda tenga marcas graves aparece acá para decidir si cuenta.'
              : undefined
          }
        />
      )}
      {data && !invertedDates && selectedId && (
        <div
          ref={measure}
          style={{ '--fill': `${String(height ?? 520)}px` } as CSSProperties}
          // Alto fijo solo en dos columnas; en pantallas angostas fluye y scrollea la página.
          className="grid min-h-0 border-[1.5px] border-input lg:h-(--fill) lg:grid-cols-[minmax(0,2fr)_minmax(0,5fr)]"
        >
          <div className="min-h-0 overflow-y-auto border-b-[1.5px] border-input bg-card lg:border-r-[1.5px] lg:border-b-0">
            {items.length === 0 ? (
              <div className="space-y-3 p-4">
                <p className="text-base text-muted-foreground">
                  Ninguna ventana coincide con los filtros.
                </p>
                {hasFilters && (
                  <Button variant="outline" onClick={clearFilters}>
                    Limpiar filtros
                  </Button>
                )}
              </div>
            ) : (
              <ul
                aria-label={estado === 'pendientes' ? 'Ventanas en revisión' : 'Ventanas resueltas'}
              >
                {items.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    timezone={data.timezone}
                    selected={item.id === selectedId}
                    onSelect={() => {
                      select(item.id);
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
          <div className="flex min-h-0 flex-col">
            <ReviewDetail
              key={selectedId}
              id={selectedId}
              onNotice={setMessage}
              onDeciding={() => {
                // Sin :id, la ventana elegida depende de la bandeja, que se refresca sola.
                if (!id) select(selectedId);
              }}
              onClosed={(text) => {
                setMessage(text);
                // Pasa a la que seguía en la lista (o a la anterior si era la última).
                const index = items.findIndex((item) => item.id === selectedId);
                const rest = items.filter((item) => item.id !== selectedId);
                select(rest[Math.min(Math.max(index, 0), rest.length - 1)]?.id);
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
