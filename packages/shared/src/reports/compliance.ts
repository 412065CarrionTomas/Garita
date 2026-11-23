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
    case 'complete_late':
      totals.complete++;
      if (window.status === 'complete_late') totals.complete_late++;
      if (window.severityLevel === 'media' || window.severityLevel === 'leve')
        totals[window.severityLevel]++;
      else if (window.severityLevel === 'grave') totals.validated++;
      else totals.withoutObservations++;
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
      window.shiftStatus === 'cancelled_by_suspension' ||
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

/**
 * Estado de un predio en un día, en el orden de importancia: una sola ventana con falla manda.
 * `pending`: solo hubo ventanas en revisión o sin sincronizar (todavía fuera del porcentaje).
 */
export const SITE_DAY_STATUSES = ['failed', 'late', 'ok', 'pending', 'none'] as const;
export type SiteDayStatus = (typeof SITE_DAY_STATUSES)[number];

export function siteDayStatus(totals: ComplianceTotals): SiteDayStatus {
  if (totals.incomplete + totals.not_done > 0) return 'failed';
  if (totals.complete_late > 0) return 'late';
  if (totals.evaluated > 0) return 'ok';
  if (totals.in_review + totals.pending_sync > 0) return 'pending';
  return 'none';
}

/**
 * Cumplimiento de cada predio día por día (los "casilleros"). Usa las mismas reglas que
 * computeCompliance: las ventanas canceladas o todavía abiertas no cuentan. Todos los días del
 * período aparecen, con `none` si el predio no tuvo rondas.
 */
export function computeSiteDayGrid(
  windows: readonly ComplianceWindow[],
  timezone: string,
  period: { desde: string; hasta: string },
) {
  const days: string[] = [];
  const date = new Date(`${period.desde}T00:00:00Z`);
  while (date.toISOString().slice(0, 10) < period.hasta) {
    days.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  const sites = new Map<
    string,
    { id: string; name: string; byDay: Map<string, ComplianceTotals> }
  >();
  for (const window of windows) {
    if (
      window.shiftStatus === 'cancelled' ||
      window.shiftStatus === 'cancelled_by_suspension' ||
      ['pending', 'in_progress', 'late'].includes(window.status)
    )
      continue;
    const day = localReportDay(window.startsAt, timezone);
    const site = sites.get(window.site.id) ?? {
      ...window.site,
      byDay: new Map<string, ComplianceTotals>(),
    };
    sites.set(site.id, site);
    const totals = site.byDay.get(day) ?? emptyComplianceTotals();
    site.byDay.set(day, totals);
    addWindow(totals, window);
  }
  return {
    days,
    sites: [...sites.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((site) => ({
        id: site.id,
        name: site.name,
        cells: days.map((day) => {
          const totals = site.byDay.get(day) ?? emptyComplianceTotals();
          return {
            day,
            status: siteDayStatus(totals),
            evaluated: totals.evaluated,
            percentage: totals.percentage,
          };
        }),
      })),
  };
}
