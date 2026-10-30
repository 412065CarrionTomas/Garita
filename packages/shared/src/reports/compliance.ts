import { windowOwner, type AssignmentOwnerSource } from '../assignments';
import type { RoundWindowStatus } from '../supervision/window-status';

export interface ComplianceGuard {
  id: string;
  name: string;
  status: string;
}
export interface ComplianceWindow {
  status: RoundWindowStatus;
  severityLevel: 'grave' | 'media' | 'leve' | null;
  startsAt: string;
  endsAt: string;
  shiftStatus: string;
  site: { id: string; name: string };
  assignments: (AssignmentOwnerSource & { guard: ComplianceGuard | null })[];
}
export interface ComplianceTotals {
  complete: number;
  incomplete: number;
  not_done: number;
  in_review: number;
  pending_sync: number;
  complete_late: number;
  withoutObservations: number;
  media: number;
  leve: number;
  validated: number;
  evaluated: number;
  percentage: number | null;
}
export function emptyComplianceTotals(): ComplianceTotals {
  return {
    complete: 0,
    incomplete: 0,
    not_done: 0,
    in_review: 0,
    pending_sync: 0,
    complete_late: 0,
    withoutObservations: 0,
    media: 0,
    leve: 0,
    validated: 0,
    evaluated: 0,
    percentage: null,
  };
}
export function complianceOwner(window: ComplianceWindow): ComplianceGuard | null {
  const id = windowOwner(window.endsAt, window.assignments);
  return window.assignments.find((assignment) => assignment.id === id)?.guard ?? null;
}
export function localReportDay(instant: string | Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
}
function addWindow(totals: ComplianceTotals, window: ComplianceWindow) {
  switch (window.status) {
    case 'complete':
      totals.complete++;
      if (window.severityLevel === 'media' || window.severityLevel === 'leve')
        totals[window.severityLevel]++;
      else if (window.severityLevel === 'grave') totals.validated++;
      else totals.withoutObservations++;
      break;
    case 'complete_late':
      totals.complete++;
      totals.complete_late++;
      break;
    case 'incomplete':
    case 'not_done':
    case 'in_review':
    case 'pending_sync':
      totals[window.status]++;
      break;
  }
  totals.evaluated = totals.complete + totals.incomplete + totals.not_done;
  totals.percentage = totals.evaluated === 0 ? null : (totals.complete / totals.evaluated) * 100;
}
export function computeCompliance(
  windows: readonly ComplianceWindow[],
  timezone: string,
  period?: { desde: string; hasta: string },
) {
  const totals = emptyComplianceTotals();
  const daily = new Map<string, ComplianceTotals>();
  const sites = new Map<string, { id: string; name: string; totals: ComplianceTotals }>();
  const guards = new Map<
    string | null,
    { id: string | null; name: string; deactivated: boolean; totals: ComplianceTotals }
  >();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  for (const window of windows) {
    if (
      window.shiftStatus === 'cancelled' ||
      ['pending', 'in_progress', 'late'].includes(window.status)
    )
      continue;
    const day = formatter.format(new Date(window.startsAt));
    const dayTotals = daily.get(day) ?? emptyComplianceTotals();
    daily.set(day, dayTotals);
    const site = sites.get(window.site.id) ?? { ...window.site, totals: emptyComplianceTotals() };
    sites.set(site.id, site);
    const owner = complianceOwner(window);
    const guard = guards.get(owner?.id ?? null) ?? {
      id: owner?.id ?? null,
      name: owner?.name ?? 'Sin vigilador',
      deactivated: owner !== null && owner.status !== 'active',
      totals: emptyComplianceTotals(),
    };
    guards.set(guard.id, guard);
    for (const target of [totals, dayTotals, site.totals, guard.totals]) addWindow(target, window);
  }
  if (period) {
    const date = new Date(`${period.desde}T00:00:00Z`);
    while (date.toISOString().slice(0, 10) < period.hasta) {
      const day = date.toISOString().slice(0, 10);
      if (!daily.has(day)) daily.set(day, emptyComplianceTotals());
      date.setUTCDate(date.getUTCDate() + 1);
    }
  }
  return {
    totals,
    daily: [...daily]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, totals]) => ({ id, name: id, totals })),
    bySite: [...sites.values()].sort((a, b) => a.name.localeCompare(b.name)),
    byGuard: [...guards.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
