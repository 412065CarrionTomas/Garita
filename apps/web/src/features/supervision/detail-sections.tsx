import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRightIcon } from 'lucide-react';
import { haversineMeters, type InvalidScanReason } from '@garita/shared';
import { StatusBadge } from '@/components/status-badge';
import type { StatusTone } from '@/components/status-badge';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { Severity, ShiftDetail } from './contracts';
import { time, windowLabels } from './contracts';

const assignmentResults = {
  scheduled: 'Programada',
  started: 'Iniciada',
  absent: 'Ausente',
  replaced: 'Reemplazada',
  closed_early: 'Cerrada antes de hora',
};
const assignmentTones: Record<keyof typeof assignmentResults, StatusTone> = {
  scheduled: 'neutral',
  started: 'success',
  absent: 'danger',
  replaced: 'neutral',
  closed_early: 'warning',
};
const severityTones: Record<Severity, StatusTone> = {
  grave: 'danger',
  media: 'warning',
  leve: 'neutral',
};
const severityLabels: Record<Severity, string> = { grave: 'Grave', media: 'Media', leve: 'Leve' };
// Mismos textos que la app del vigilador; un motivo nuevo de la API se muestra tal cual.
const rejectReasons: Record<InvalidScanReason, string> = {
  malformed: 'Código QR no válido',
  signature: 'Firma inválida',
  other_site: 'Punto de otro predio',
  outdated_version: 'Código QR desactualizado',
  unknown_checkpoint: 'Punto desconocido',
  tag_not_associated: 'Etiqueta no asociada',
  tag_replaced: 'Etiqueta reemplazada',
};
const rejectReason = (reason: string) =>
  (rejectReasons as Partial<Record<string, string>>)[reason] ?? reason;

/**
 * Bloque desplegable de la foja: un renglón con título y cantidad, cerrado por defecto. El título
 * va al tamaño del texto de la tabla de puntos para que se lea igual de fácil.
 */
export function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <details
      className="group border-t border-border"
      onToggle={(event) => {
        // "nearest": si entra, lo muestra entero; si es más alto que el panel, deja el título arriba.
        if (!event.currentTarget.open) return;
        // Con movimiento reducido salta sin animar, como el resto de los desplazamientos.
        const reduce =
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        // jsdom no implementa scrollIntoView
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        event.currentTarget.scrollIntoView?.({
          block: 'nearest',
          behavior: reduce ? 'auto' : 'smooth',
        });
      }}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 py-2.5 hover:bg-accent [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden="true"
          className="size-5 text-muted-foreground transition-transform group-open:rotate-90"
        />
        <h2 className="font-cond text-lg font-semibold tracking-wide">{title}</h2>
        {count !== undefined && (
          <span className="font-cond text-lg font-semibold text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
      </summary>
      <div className="space-y-3 pb-4 pl-7.5 text-base">{children}</div>
    </details>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="text-muted-foreground">{children}</p>;
}

/** Renglón de lista: lo principal en negrita a la izquierda, el sello a la derecha, el detalle abajo. */
function Item({
  main,
  stamp,
  detail,
  className,
}: {
  main: ReactNode;
  stamp?: ReactNode;
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <li className={cn('space-y-1 py-2.5 first:pt-0', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="font-semibold">{main}</p>
        {stamp}
      </div>
      {detail && <div className="text-muted-foreground">{detail}</div>}
    </li>
  );
}

/** Cierre del turno, bajo los datos principales; solo aparece si el turno ya cerró. */
export function CoverageNote({ detail }: { detail: ShiftDetail }) {
  if (!detail.actual.closedAt && detail.status !== 'uncovered') return null;
  return (
    <div className="space-y-1 border-t border-border px-5 py-2.5">
      {detail.actual.closedAt && (
        <p>
          Cerró a las{' '}
          <span className="font-semibold tabular-nums">{time(detail.actual.closedAt)}</span>
        </p>
      )}
      {detail.status === 'uncovered' && (
        <p className="font-semibold text-danger">
          Sin cobertura desde{' '}
          {detail.actual.closedAt ? time(detail.actual.closedAt) : 'hora desconocida'}
          {detail.actual.closeReason ? ` · Motivo: ${detail.actual.closeReason}` : ''}
        </p>
      )}
      {detail.actual.closedEarly && detail.status !== 'uncovered' && (
        <p>
          Cierre antes de hora
          {detail.actual.closeReason ? ` · Motivo: ${detail.actual.closeReason}` : ''}
          {detail.actual.closedBy ? ` · Cerró: ${detail.actual.closedBy}` : ''}
        </p>
      )}
    </div>
  );
}

export function AssignmentsSection({ detail }: { detail: ShiftDetail }) {
  return (
    <Section title="Historial de asignaciones" count={detail.assignments.length}>
      {detail.assignments.length === 0 ? (
        <Empty>Sin asignaciones.</Empty>
      ) : (
        <ol className="divide-y divide-border">
          {detail.assignments.map((assignment) => (
            <Item
              key={assignment.id}
              main={
                <>
                  {assignment.guard
                    ? `${assignment.guard.firstName} ${assignment.guard.lastName}`
                    : 'Sin vigilador'}{' '}
                  <span className="font-normal tabular-nums">
                    {time(assignment.startsAt)}–{time(assignment.endsAt)}
                  </span>
                </>
              }
              stamp={
                <span className="flex gap-1.5">
                  {assignment.isCurrent && <StatusBadge tone="signal">Vigente</StatusBadge>}
                  <StatusBadge tone={assignmentTones[assignment.result]}>
                    {assignmentResults[assignment.result]}
                  </StatusBadge>
                </span>
              }
              detail={
                <>
                  Asignó {assignment.assignedBy.firstName} {assignment.assignedBy.lastName}
                  {assignment.reassignedAt
                    ? ` · reasignado a las ${time(assignment.reassignedAt)}`
                    : ''}
                </>
              }
            />
          ))}
        </ol>
      )}
    </Section>
  );
}

export function WindowsSection({ detail }: { detail: ShiftDetail }) {
  const names = new Map(detail.rounds.map((round) => [round.id, round.name]));
  return (
    <Section title="Rondas y ventanas" count={detail.windows.length}>
      {detail.windows.length === 0 ? (
        <Empty>Las ventanas se generan cuando empieza el turno.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {detail.windows.map((window) => (
            <Item
              key={window.id}
              main={
                <>
                  <span className="tabular-nums">
                    {time(window.startsAt)}–{time(window.endsAt)}
                  </span>{' '}
                  <span className="font-normal">
                    {names.get(window.roundId) ?? 'Ronda'} · ventana {window.windowIndex + 1}
                  </span>
                </>
              }
              stamp={
                <StatusBadge
                  tone={
                    window.status === 'complete'
                      ? 'success'
                      : window.status === 'not_done'
                        ? 'danger'
                        : window.status === 'late' || window.status === 'complete_late'
                          ? 'warning'
                          : 'neutral'
                  }
                >
                  {windowLabels[window.status]}
                </StatusBadge>
              }
              detail={
                <>
                  <span className="font-semibold text-foreground tabular-nums">
                    {window.recordedCount} de {window.expectedCount}
                  </span>{' '}
                  puntos registrados
                  {window.severityLevel && ` · Gravedad ${window.severityLevel}`}
                  {(window.status === 'in_review' || window.severityLevel) && (
                    <>
                      {' · '}
                      <Link
                        to={`/revision/${window.id}`}
                        className="font-semibold text-foreground underline underline-offset-4"
                      >
                        Revisar ventana
                      </Link>
                    </>
                  )}
                </>
              }
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Recorrido registrado, en texto. El mapa de la ruta vive en el panel derecho de la pantalla. */
export function RouteSection({ detail }: { detail: ShiftDetail }) {
  const points = new Map(detail.points.map((point) => [point.id, point]));
  return (
    <Section title="Recorrido" count={detail.route.length}>
      {detail.route.length === 0 ? (
        <Empty>Todavía no hay puntos registrados.</Empty>
      ) : (
        <ol className="divide-y divide-border" aria-label="Puntos del recorrido">
          {detail.route.map((item, index) => {
            const point = points.get(item.checkpointId);
            return (
              <Item
                key={`${item.checkpointId}-${index}`}
                main={
                  <>
                    <span className="tabular-nums">{time(item.occurredAtDevice)}</span>{' '}
                    {point?.name ?? 'Punto'}
                  </>
                }
                detail={
                  point
                    ? `A ${Math.round(haversineMeters(item.latitude, item.longitude, point.latitude, point.longitude))} m del punto configurado`
                    : 'Distancia no disponible'
                }
              />
            );
          })}
        </ol>
      )}
    </Section>
  );
}

export function RecordsSection({
  detail,
  flaggedOnly,
  severity,
  onFlaggedOnly,
  onSeverity,
}: {
  detail: ShiftDetail;
  flaggedOnly: boolean;
  severity: '' | Severity;
  onFlaggedOnly: (value: boolean) => void;
  onSeverity: (value: '' | Severity) => void;
}) {
  const points = new Map(detail.points.map((point) => [point.id, point.name]));
  const records = detail.records.filter(
    (record) =>
      (!flaggedOnly || record.flags.length > 0) &&
      (!severity || record.flags.some((flag) => flag.severity === severity)),
  );
  return (
    <Section title="Registros" count={detail.records.length}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Label className="flex items-center gap-2">
          <Checkbox
            checked={flaggedOnly}
            onCheckedChange={(checked) => {
              onFlaggedOnly(checked === true);
            }}
          />
          Solo marcados
        </Label>
        <div className="flex items-center gap-2">
          <Label htmlFor="severity-filter">Gravedad</Label>
          <NativeSelect
            id="severity-filter"
            value={severity}
            onChange={(event) => {
              onSeverity(event.target.value as '' | Severity);
            }}
          >
            <NativeSelectOption value="">Todas</NativeSelectOption>
            <NativeSelectOption value="grave">Grave</NativeSelectOption>
            <NativeSelectOption value="media">Media</NativeSelectOption>
            <NativeSelectOption value="leve">Leve</NativeSelectOption>
          </NativeSelect>
        </div>
      </div>
      {detail.phoneWithoutNfc && <StatusBadge tone="neutral">Celular sin NFC</StatusBadge>}
      {records.length === 0 ? (
        <Empty>No hay registros para este filtro.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {records.map((record) => {
            const flags = record.flags.filter((flag) => !severity || flag.severity === severity);
            return (
              <Item
                key={record.id}
                main={
                  <>
                    <span className="tabular-nums">{time(record.occurredAtDevice)}</span>{' '}
                    {points.get(record.checkpointId) ?? 'Punto'}
                  </>
                }
                stamp={
                  flags.length === 0 ? (
                    <span className="text-muted-foreground">Sin marcas</span>
                  ) : undefined
                }
                detail={
                  flags.length > 0 && (
                    <span className="flex flex-col gap-1.5">
                      {flags.map((flag) => (
                        <span key={flag.id} className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={severityTones[flag.severity]}>
                            {severityLabels[flag.severity]}
                          </StatusBadge>
                          <span className="text-foreground">{flag.reason}</span>
                        </span>
                      ))}
                    </span>
                  )
                }
              />
            );
          })}
        </ul>
      )}
    </Section>
  );
}

export function RejectedSection({ detail }: { detail: ShiftDetail }) {
  return (
    <Section title="Intentos rechazados" count={detail.rejectedAttempts.length}>
      {detail.rejectedAttempts.length === 0 ? (
        <Empty>No hay intentos rechazados.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {detail.rejectedAttempts.map((attempt) => (
            <Item
              key={attempt.id}
              className={attempt.highlighted ? 'text-danger' : undefined}
              main={
                <>
                  <span className="tabular-nums">{time(attempt.occurredAtDevice)}</span>{' '}
                  {rejectReason(attempt.reason)}
                </>
              }
              stamp={
                <StatusBadge tone={attempt.highlighted ? 'danger' : 'neutral'}>
                  {attempt.method.toUpperCase()}
                </StatusBadge>
              }
              detail={attempt.highlighted ? 'QR de versión regenerada' : undefined}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}
