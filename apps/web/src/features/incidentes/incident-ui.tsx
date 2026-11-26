/* eslint react-refresh/only-export-components: off */
import {
  INCIDENT_CLASSIFICATION_LABELS,
  INCIDENT_SEVERITY_LABELS,
  type IncidentFollowUpStatus,
  type IncidentSeverity,
} from '@garita/shared';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet } from '@/lib/api-client';

export type ClassificationStatus = keyof typeof INCIDENT_CLASSIFICATION_LABELS;

const CLASSIFICATION_TONE: Record<ClassificationStatus, StatusTone> = {
  pending: 'warning',
  client_visible: 'success',
  internal: 'neutral',
};
const SEVERITY_TONE: Record<IncidentSeverity, StatusTone> = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
};

export function ClassificationBadge({ status }: { status: ClassificationStatus }) {
  return (
    <StatusBadge tone={CLASSIFICATION_TONE[status]}>
      {INCIDENT_CLASSIFICATION_LABELS[status]}
    </StatusBadge>
  );
}

export function SeverityBadge({ severity }: { severity: IncidentSeverity | null }) {
  if (!severity) return <span className="text-muted-foreground">—</span>;
  return (
    <StatusBadge tone={SEVERITY_TONE[severity]}>{INCIDENT_SEVERITY_LABELS[severity]}</StatusBadge>
  );
}

export function FollowUpBadge({ status }: { status: IncidentFollowUpStatus }) {
  if (status === 'none') return <span className="text-muted-foreground">—</span>;
  return (
    <StatusBadge tone={status === 'open' ? 'signal' : 'success'}>
      {status === 'open' ? 'Abierto' : 'Cerrado'}
    </StatusBadge>
  );
}

/**
 * Los atajos de teclado no actúan mientras se escribe en un campo ni con un diálogo abierto
 * (por ejemplo, el visor de fotos).
 */
export function shortcutsBlocked(event: KeyboardEvent) {
  const target = event.target;
  const typing =
    target instanceof HTMLElement &&
    (['TEXTAREA', 'INPUT', 'SELECT'].includes(target.tagName) || target.isContentEditable);
  return typing || document.querySelector('[role="dialog"]') !== null;
}

const yearIn = (value: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en', { timeZone, year: 'numeric' }).format(value);

/** "24/11 08:06"; con año solo si no es el actual en la zona de la empresa. */
export function shortDateTime(value: Date, timeZone: string) {
  const sameYear = yearIn(value, timeZone) === yearIn(new Date(), timeZone);
  return value.toLocaleString('es-AR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}
export const fullDateTime = (value: Date, timeZone: string) =>
  value.toLocaleString('es-AR', { timeZone, hourCycle: 'h23' });

/** Antigüedad legible: "hace 40 min", "hace 27 h", "hace 3 d". */
export function ageText(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `hace ${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `hace ${String(hours)} h`;
  return `hace ${String(Math.floor(hours / 24))} d`;
}

export function RowsSkeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <div role="status" className="space-y-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

export function useIncidentPendingCount(enabled: boolean) {
  return useQuery({
    queryKey: ['incidents', 'count'],
    queryFn: () => apiGet('/incidentes/cola/cantidad', z.object({ count: z.number() })),
    refetchInterval: 30_000,
    enabled,
  });
}
