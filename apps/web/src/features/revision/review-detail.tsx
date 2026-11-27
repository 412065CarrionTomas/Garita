import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { CheckIcon } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { DecisionDialog, type ReviewAction } from './decision-dialog';
import {
  DECISION_LABELS,
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  STATUS_LABELS,
  clock,
  dayTime,
  detailSchema,
  elapsed,
  flagLabel,
  gap,
  type ReviewRecord,
  type Severity,
} from './review-contracts';

const sectionTitle = 'font-cond text-lg font-semibold tracking-wider uppercase';
const LOCATION_FLAGS = new Set(['out_of_range', 'simulated_location', 'location_unverifiable']);
const SHAPE: Record<Severity, string> = { grave: '▲', media: '◆', leve: '●' };
const CHIP: Record<Severity, string> = {
  grave: 'bg-danger-soft text-danger',
  media: 'bg-warning-soft text-warning',
  leve: 'bg-muted text-muted-foreground',
};
const STRIPE: Record<Severity, string> = {
  grave: 'border-l-danger',
  media: 'border-l-warning',
  leve: 'border-l-input',
};

/** Marca como etiqueta: forma + nombre sobre fondo suave del color de su gravedad. */
export function FlagChip({ severity, children }: { severity: Severity; children: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-semibold whitespace-nowrap',
        CHIP[severity],
      )}
    >
      <span aria-hidden="true">{SHAPE[severity]}</span>
      <span className="sr-only">{SEVERITY_LABELS[severity]}:</span>
      {children}
    </span>
  );
}

const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
const meters = (value: number) =>
  value >= 1000
    ? `${(value / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km`
    : `${String(value)} m`;

/**
 * Los datos que respaldan la marca. Primero los guardados al generarla (`details`): son los que la
 * dispararon aunque después se haya movido el punto o el reloj estuviera alterado.
 */
function evidence(record: ReviewRecord, flag: ReviewRecord['flags'][number]): string[] {
  const d = flag.details ?? {};
  if (flag.type === 'impossible_time') {
    const seconds = num(d.timeDeltaSeconds);
    const distance = num(d.distanceMeters);
    return [
      ...(seconds === null
        ? []
        : // El evaluador admite 0 o negativo (dos lecturas en el mismo instante).
          [
            seconds <= 0
              ? 'en el mismo instante que el punto anterior'
              : `${gap(seconds)} desde el punto anterior`,
          ]),
      ...(distance === null ? [] : [`a ${meters(distance)}`]),
      ...(num(d.maxSpeedKmh) === null ? [] : [`máximo ${String(num(d.maxSpeedKmh))} km/h`]),
    ];
  }
  if (flag.type === 'time_altered') {
    if (flag.reason === 'trusted_time_in_future') return ['Hora adelantada respecto del servidor'];
    // Lo que se movió el reloj desde la referencia del turno, no el desfase absoluto.
    const offset = num(d.deviceOffsetMs);
    const reference = num(d.referenceOffsetMs);
    if (offset === null) return [];
    const seconds = Math.abs(Math.round((offset - (reference ?? 0)) / 1000));
    return seconds === 0 ? [] : [`reloj movido ${gap(seconds)}`];
  }
  if (flag.type === 'qr_on_tagged_point')
    return [d.phoneNfc === 'on' ? 'Leído por QR con el NFC encendido' : 'Leído por QR'];
  if (LOCATION_FLAGS.has(flag.type)) {
    const distance = num(d.distanceMeters) ?? record.distanceMeters;
    const radius = num(d.toleranceRadiusMeters) ?? record.radiusMeters;
    const accuracy = num(d.accuracyMeters) ?? num(record.accuracyMeters);
    if (distance === null) return ['Sin ubicación en la lectura'];
    return [
      `${meters(distance)} del punto`,
      `radio ${String(radius)} m`,
      ...(accuracy === null ? [] : [`precisión ± ${String(accuracy)} m`]),
    ];
  }
  return [];
}

function worst(record: ReviewRecord): Severity {
  return (
    [...record.flags].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])[0]
      ?.severity ?? 'leve'
  );
}

function useReviewDetail(id: string) {
  return useQuery({
    queryKey: ['revision', 'detail', id],
    queryFn: () => apiGet(`/ventanas-ronda/${encodeURIComponent(id)}`, detailSchema),
  });
}

function Tile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: string;
}) {
  return (
    <div className={cn('bg-card px-4 py-2.5', tone)}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-2">
        <span className="t-numeral text-2xl leading-tight">{value}</span>
        {detail && <span className="text-sm text-muted-foreground">{detail}</span>}
      </dd>
    </div>
  );
}

function RecordCard({
  record,
  number,
  timezone,
  onAction,
}: {
  record: ReviewRecord;
  number: number;
  timezone: string;
  onAction?: () => void;
}) {
  const flags = [...record.flags].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  return (
    <li
      className={cn(
        'border-[1.5px] border-l-4 border-input bg-card px-4 py-3',
        record.invalidated ? 'border-l-input opacity-75' : STRIPE[worst(record)],
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          aria-label={`Punto ${String(number)}`}
          className="t-numeral flex size-8 shrink-0 items-center justify-center bg-foreground text-background"
        >
          {number}
        </span>
        <p className="min-w-0 flex-1">
          <span className={cn('text-lg font-semibold', record.invalidated && 'line-through')}>
            {record.checkpointName}
          </span>
          <span className="text-base text-muted-foreground tabular-nums">
            {'  '}
            {clock(record.occurredAtDevice, timezone, true)} · {record.method.toUpperCase()}
          </span>
        </p>
        {record.invalidated && (
          <span className="rounded-sm bg-muted px-2 py-0.5 font-semibold">
            Invalidado: no cuenta
          </span>
        )}
        {onAction && (
          <Button variant={record.invalidated ? 'outline' : 'destructive'} onClick={onAction}>
            {record.invalidated ? 'Restituir' : 'Invalidar'}
          </Button>
        )}
      </div>
      <ul className="mt-2.5 space-y-2 pl-11">
        {flags.map((flag) => {
          const { label, meaning } = flagLabel(flag.type);
          const facts = evidence(record, flag);
          return (
            <li key={flag.type} className="space-y-1">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <FlagChip severity={flag.severity}>{label}</FlagChip>
                {facts.map((fact) => (
                  <span key={fact} className="font-semibold tabular-nums">
                    {fact}
                  </span>
                ))}
              </p>
              {meaning && <p className="text-base">{meaning}</p>}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/**
 * Ventana elegida en la bandeja. Primero lo que hay que decidir: las lecturas con marcas, cada una
 * con su evidencia y su acción; las lecturas limpias van resumidas al pie.
 */
export function ReviewDetail({
  id,
  onClosed,
  onNotice,
}: {
  id: string;
  /** La ventana dejó de estar pendiente: la bandeja pasa a la siguiente. */
  onClosed: (text: string) => void;
  /** Se guardó una decisión y la ventana sigue elegida. */
  onNotice: (text: string) => void;
}) {
  const { data, isPending, isError, refetch } = useReviewDetail(id);
  const [action, setAction] = useState<ReviewAction | null>(null);
  if (isPending)
    return (
      <div role="status" className="space-y-3 p-5">
        <span className="sr-only">Cargando ventana…</span>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (isError)
    return (
      <Alert variant="destructive" className="m-5">
        No pudimos cargar la ventana.{' '}
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Reintentar
        </Button>
      </Alert>
    );
  const pending = data.status === 'in_review';
  const number = (record: ReviewRecord) => data.records.indexOf(record) + 1;
  const attention = data.records.filter((r) => r.flags.length > 0 || r.invalidated);
  const clean = data.records.filter((r) => !attention.includes(r));
  const flagged = attention.filter((r) => !r.invalidated);
  const lastDecision = data.decisions.at(-1);
  const history = data.guardHistory;
  const title = `${data.roundName} · ventana ${String(data.windowIndex + 1)}`;
  const recordAction = (r: ReviewRecord): ReviewAction =>
    r.invalidated
      ? {
          title: 'Restituir registro',
          doneText: 'Registro restituido',
          effect: `${r.checkpointName} vuelve a contar para la ronda.`,
          paths: [`/registros-puntos/${r.id}/restituir`],
        }
      : {
          title: 'Invalidar registro',
          doneText: 'Registro invalidado',
          effect: `${r.checkpointName} deja de contar: la ronda se recalcula y puede quedar incompleta.`,
          paths: [`/registros-puntos/${r.id}/invalidar`],
        };

  return (
    <article aria-labelledby="review-window-title" className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b-[1.5px] border-input bg-card px-5 py-3">
        <div className="min-w-0 flex-1 basis-80">
          <h2 id="review-window-title" className="t-headline">
            {title}
          </h2>
          <p className="truncate text-base text-muted-foreground">
            <span className="font-semibold text-foreground">
              {data.guardName ?? 'Sin vigilador'}
            </span>
            {' · '}
            {data.siteName} · {dayTime(data.startsAt, data.timezone)}–
            {clock(data.endsAt, data.timezone)} ·{' '}
            <Link
              to={`/supervision/turnos/${data.shiftId}`}
              className="underline underline-offset-4"
            >
              Ver foja del turno
            </Link>
          </p>
        </div>
        {pending ? (
          <div className="flex shrink-0 gap-2">
            {flagged.length > 1 && (
              <Button
                variant="destructive"
                onClick={() => {
                  setAction({
                    title: `Invalidar ${String(flagged.length)} marcados`,
                    doneText: `${String(flagged.length)} lecturas invalidadas`,
                    effect: `Dejan de contar: ${flagged.map((r) => r.checkpointName).join(', ')}. La ronda se recalcula.`,
                    paths: flagged.map((r) => `/registros-puntos/${r.id}/invalidar`),
                  });
                }}
              >
                Invalidar los {flagged.length}
              </Button>
            )}
            <Button
              onClick={() => {
                setAction({
                  title: 'Validar ventana',
                  effect:
                    'La ronda cuenta como hecha aunque tenga marcas. Las lecturas no cambian.',
                  paths: [`/ventanas-ronda/${data.id}/validar`],
                  closesWindow: true,
                });
              }}
            >
              Validar ventana
            </Button>
          </div>
        ) : (
          <p className="text-base">
            <span className="font-semibold">{STATUS_LABELS[data.status] ?? data.status}</span>
            {lastDecision &&
              ` · ${lastDecision.kind === 'validate' ? 'validada' : 'recalculada'} por ${lastDecision.decidedBy} el ${dayTime(lastDecision.decidedAt, data.timezone)}`}
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <dl className="grid grid-cols-2 gap-px border-[1.5px] border-input bg-border xl:grid-cols-[1fr_1fr_1fr_2fr]">
          <Tile
            label="Puntos registrados"
            value={`${String(data.recordedCount)}/${String(data.expectedCount)}`}
          />
          <Tile
            label="Lecturas con marcas"
            value={flagged.length}
            detail={`de ${String(data.records.length)}`}
            tone={flagged.length ? 'text-danger' : undefined}
          />
          <Tile
            label="En revisión hace"
            value={data.inReviewSince ? elapsed(data.inReviewSince) : '—'}
          />
          <Tile
            label={`Antecedentes del vigilador (${String(history?.days ?? 30)} días)`}
            value={history ? `${String(history.graveFlags)} graves` : '—'}
            detail={
              history
                ? `en ${String(history.records)} lecturas · ${String(history.invalidatedRecords)} invalidadas`
                : 'Sin vigilador asignado'
            }
            tone={history && history.graveFlags > 0 ? 'bg-warning-soft text-warning' : undefined}
          />
        </dl>

        <section aria-labelledby="review-flagged" className="space-y-2">
          <h3 id="review-flagged" className={sectionTitle}>
            Lecturas a decidir ({attention.length})
          </h3>
          {attention.length === 0 ? (
            <p className="border-[1.5px] border-input bg-card px-4 py-3 text-base">
              {pending
                ? 'No quedan lecturas con marcas: la ronda se puede validar.'
                : 'Ninguna lectura de esta ventana tiene marcas.'}
            </p>
          ) : (
            <ol className="space-y-2">
              {attention.map((r) => (
                <RecordCard
                  key={r.id}
                  record={r}
                  number={number(r)}
                  timezone={data.timezone}
                  onAction={() => {
                    setAction(recordAction(r));
                  }}
                />
              ))}
            </ol>
          )}
        </section>

        {clean.length > 0 && (
          <section aria-labelledby="review-clean" className="space-y-2">
            <h3 id="review-clean" className={cn(sectionTitle, 'text-muted-foreground')}>
              Sin marcas ({clean.length})
            </h3>
            <ul className="flex flex-wrap gap-2">
              {clean.map((r) => (
                <li
                  key={r.id}
                  className="inline-flex items-center gap-2 rounded-sm border border-border bg-card px-2.5 py-1"
                >
                  <CheckIcon aria-hidden="true" className="size-4 text-success" />
                  <span className="tabular-nums text-muted-foreground">{number(r)}</span>
                  <span>{r.checkpointName}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {clock(r.occurredAtDevice, data.timezone)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.decisions.length > 0 && (
          <section aria-labelledby="review-history" className="space-y-2">
            <h3 id="review-history" className={sectionTitle}>
              Historial de decisiones
            </h3>
            <ol className="divide-y divide-border border-[1.5px] border-input bg-card">
              {data.decisions.map((d) => {
                const record = data.records.find((r) => r.id === d.checkpointRecordId);
                return (
                  <li key={d.id} className="px-4 py-2.5 text-base">
                    <p>
                      <span className="font-semibold">
                        {DECISION_LABELS[d.kind]}
                        {record && ` · ${record.checkpointName}`}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {' '}
                        · {d.decidedBy} · {dayTime(d.decidedAt, data.timezone)}
                      </span>
                    </p>
                    <p>{d.comment}</p>
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </div>
      <DecisionDialog
        action={action}
        onClose={() => {
          setAction(null);
        }}
        onDone={(done, window) => {
          setAction(null);
          const name = `${title} (${data.siteName})`;
          // Una lectura puede contar para dos ventanas: solo vale el estado si es esta misma.
          const status = window?.id === data.id ? window.status : undefined;
          if (done.closesWindow) onClosed(`${name} validada.`);
          // Invalidar puede sacar la ventana de revisión: se avisa y la bandeja pasa a la siguiente.
          else if (pending && status && status !== 'in_review')
            onClosed(`${name} quedó ${(STATUS_LABELS[status] ?? status).toLowerCase()}.`);
          else
            onNotice(
              `${done.doneText ?? done.title} en ${name}${status ? `: la ventana está ${(STATUS_LABELS[status] ?? status).toLowerCase()}` : ''}.`,
            );
        }}
      />
    </article>
  );
}
