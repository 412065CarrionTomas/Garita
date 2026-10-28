import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { apiGet } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { shiftDetailSchema, shiftLabels, shiftTones, time } from './contracts';
import type { Severity } from './contracts';
import { RecordsSection, RouteSection, WindowsSection } from './detail-sections';

export function ShiftDetailPage() {
  const { id } = useParams();
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [severity, setSeverity] = useState<'' | Severity>('');
  const {
    data: detail,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['supervision', 'detalle', id],
    queryFn: () => apiGet(`/turnos/${encodeURIComponent(id ?? '')}/detalle`, shiftDetailSchema),
    enabled: Boolean(id),
  });
  if (isPending) return <p role="status">Cargando detalle…</p>;
  if (isError)
    return (
      <Alert role="alert">
        No pudimos cargar el turno.{' '}
        <button type="button" className="underline" onClick={() => void refetch()}>
          Reintentar
        </button>
      </Alert>
    );
  return (
    <section className="space-y-6" aria-labelledby="detail-title">
      <Link
        to="/supervision"
        className="text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← Volver a En vivo
      </Link>
      <PageHeader
        id="detail-title"
        title={`Turno en ${detail.site.name}`}
        description="Detalle de cobertura, ventanas y registros"
        actions={
          <StatusBadge tone={shiftTones[detail.status]}>{shiftLabels[detail.status]}</StatusBadge>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Horario y cobertura</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
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
            <p className="font-medium text-danger">
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
          <div className="flex flex-wrap gap-2">
            {detail.status === 'uncovered' && (
              <Button disabled title="Disponible próximamente">
                Cubrir el resto · Disponible próximamente
              </Button>
            )}
            {(detail.status === 'without_guard' || detail.status === 'unassigned') && (
              <Button disabled title="Disponible próximamente">
                Asignarle uno · Disponible próximamente
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Historial de asignaciones</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {detail.assignments.map((assignment) => (
              <li key={assignment.id} className="text-sm">
                {assignment.guard
                  ? `${assignment.guard.firstName} ${assignment.guard.lastName}`
                  : 'Sin vigilador'}{' '}
                · {time(assignment.startsAt)}–{time(assignment.endsAt)}
                {assignment.isCurrent ? ' · Vigente' : ''}
              </li>
            ))}
          </ol>
          {detail.assignments.length === 0 && <p>Sin asignaciones.</p>}
        </CardContent>
      </Card>
      <WindowsSection detail={detail} />
      <RouteSection detail={detail} />
      <RecordsSection
        detail={detail}
        flaggedOnly={flaggedOnly}
        severity={severity}
        onFlaggedOnly={setFlaggedOnly}
        onSeverity={setSeverity}
      />
      <Card>
        <CardHeader>
          <CardTitle>Intentos rechazados</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {detail.rejectedAttempts.map((attempt) => (
              <li
                key={attempt.id}
                className={attempt.highlighted ? 'font-semibold text-danger' : ''}
              >
                {time(attempt.occurredAtDevice)} · {attempt.method.toUpperCase()} · {attempt.reason}
                {attempt.highlighted ? ' · QR de versión regenerada' : ''}
              </li>
            ))}
          </ul>
          {detail.rejectedAttempts.length === 0 && <p>No hay intentos rechazados.</p>}
        </CardContent>
      </Card>
    </section>
  );
}
