import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { haversineMeters } from '@garita/shared';
import { StatusBadge } from '@/components/status-badge';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Checkbox } from '@/components/ui/checkbox';
import type { Severity, ShiftDetail } from './contracts';
import { time, windowLabels } from './contracts';

const assignmentResults = {
  scheduled: 'Programada',
  started: 'Iniciada',
  absent: 'Ausente',
  replaced: 'Reemplazada',
  closed_early: 'Cerrada antes de hora',
};

/** Bloque de la foja bajo la tabla de puntos: rótulo en condensada y filete encima. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border pt-4">
      <h2 className="t-label text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function CoverageSection({ detail }: { detail: ShiftDetail }) {
  return (
    <Section title="Horario y cobertura">
      <div className="space-y-1.5 text-sm">
        <p>
          Programado:{' '}
          <span className="tabular-nums">
            {time(detail.scheduled.startsAt)}–{time(detail.scheduled.endsAt)}
          </span>
        </p>
        <p>
          Inicio real: {detail.actual.startedAt ? time(detail.actual.startedAt) : 'No iniciado'}
        </p>
        <p>Cierre real: {detail.actual.closedAt ? time(detail.actual.closedAt) : 'Sin cierre'}</p>
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
    </Section>
  );
}

export function AssignmentsSection({ detail }: { detail: ShiftDetail }) {
  return (
    <Section title="Historial de asignaciones">
      <ol className="space-y-2">
        {detail.assignments.map((assignment) => (
          <li key={assignment.id} className="text-sm">
            {assignment.guard
              ? `${assignment.guard.firstName} ${assignment.guard.lastName}`
              : 'Sin vigilador'}{' '}
            · {time(assignment.startsAt)}–{time(assignment.endsAt)}
            {' · '}
            {assignmentResults[assignment.result]}
            {assignment.isCurrent ? ' · Vigente' : ''}
            {' · Asignó: '}
            {assignment.assignedBy.firstName} {assignment.assignedBy.lastName}
            {assignment.reassignedAt ? ` · Reasignó a las ${time(assignment.reassignedAt)}` : ''}
          </li>
        ))}
      </ol>
      {detail.assignments.length === 0 && <p className="text-sm">Sin asignaciones.</p>}
    </Section>
  );
}

export function WindowsSection({ detail }: { detail: ShiftDetail }) {
  const names = new Map(detail.rounds.map((round) => [round.id, round.name]));
  return (
    <Section title="Rondas y ventanas">
      {detail.windows.length === 0 ? (
        <p className="text-sm">No hay ventanas para este turno.</p>
      ) : (
        <div className="divide-y divide-border">
          {detail.windows.map((window) => (
            <div key={window.id} className="space-y-1 py-3 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  {names.get(window.roundId) ?? 'Ronda'} · ventana {window.windowIndex + 1}
                </p>
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
              </div>
              <p className="text-sm text-muted-foreground tabular-nums">
                {time(window.startsAt)}–{time(window.endsAt)} · {window.recordedCount} de{' '}
                {window.expectedCount} puntos registrados
              </p>
              {window.severityLevel && (
                <p className="text-sm">⚠ Gravedad: {window.severityLevel}</p>
              )}
              {(window.status === 'in_review' || window.severityLevel) && (
                <Link
                  to={`/revision/${window.id}`}
                  className="text-sm font-semibold underline underline-offset-4"
                >
                  Revisar ventana
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Recorrido registrado, en texto. El mapa de la ruta vive en el panel derecho de la pantalla. */
export function RouteSection({ detail }: { detail: ShiftDetail }) {
  const points = new Map(detail.points.map((point) => [point.id, point]));
  return (
    <Section title="Recorrido">
      <ol className="list-inside list-decimal space-y-2" aria-label="Puntos del recorrido">
        {detail.route.map((item, index) => {
          const point = points.get(item.checkpointId);
          return (
            <li key={`${item.checkpointId}-${index}`} className="text-sm">
              {point?.name ?? 'Punto'} · {time(item.occurredAtDevice)} ·{' '}
              {point
                ? `${Math.round(haversineMeters(item.latitude, item.longitude, point.latitude, point.longitude))} m del punto configurado`
                : 'Distancia no disponible'}
            </li>
          );
        })}
      </ol>
      {detail.route.length === 0 && (
        <p className="text-sm">No hay puntos registrados en el recorrido.</p>
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
    <Section title="Registros">
      <div className="flex flex-wrap items-end gap-4">
        <Label className="flex items-center gap-2">
          <Checkbox
            checked={flaggedOnly}
            onCheckedChange={(checked) => {
              onFlaggedOnly(checked === true);
            }}
          />
          Solo marcados
        </Label>
        <div className="space-y-2">
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
      <ul className="divide-y divide-border">
        {records.map((record) => (
          <li key={record.id} className="py-2 first:pt-0">
            <p className="font-semibold">
              {points.get(record.checkpointId) ?? 'Punto'} ·{' '}
              <span className="tabular-nums">{time(record.occurredAtDevice)}</span>
            </p>
            {record.flags.length ? (
              <ul>
                {record.flags
                  .filter((flag) => !severity || flag.severity === severity)
                  .map((flag) => (
                    <li key={flag.id} className="text-sm">
                      {flag.severity}: {flag.reason}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Sin marcas</p>
            )}
          </li>
        ))}
      </ul>
      {records.length === 0 && <p className="text-sm">No hay registros para este filtro.</p>}
      {detail.phoneWithoutNfc && <p className="text-sm">Celular sin NFC</p>}
    </Section>
  );
}

export function RejectedSection({ detail }: { detail: ShiftDetail }) {
  return (
    <Section title="Intentos rechazados">
      <ul className="space-y-2">
        {detail.rejectedAttempts.map((attempt) => (
          <li
            key={attempt.id}
            className={attempt.highlighted ? 'text-sm font-semibold text-danger' : 'text-sm'}
          >
            <span className="tabular-nums">{time(attempt.occurredAtDevice)}</span> ·{' '}
            {attempt.method.toUpperCase()} · {attempt.reason}
            {attempt.highlighted ? ' · QR de versión regenerada' : ''}
          </li>
        ))}
      </ul>
      {detail.rejectedAttempts.length === 0 && (
        <p className="text-sm">No hay intentos rechazados.</p>
      )}
    </Section>
  );
}
