import { useQuery } from '@tanstack/react-query';
import {
  incidentReportResponseSchema,
  localReportDay,
  reportPendingResponseSchema,
  reportResponseSchema,
  siteDayGridResponseSchema,
} from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { shiftListSchema } from '@/features/supervision/contracts';

export type SummaryPeriod = '7d' | '30d';

// shortcut: la web no conoce la zona de la empresa hasta recibir un informe (igual que
// Cumplimiento); si se agrega a /auth/me, usarla acá.
const COMPANY_TIMEZONE = 'America/Argentina/Buenos_Aires';

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Últimos `days` días incluido hoy: el "hasta" de los informes no se incluye. */
export function lastDaysQuery(days: number, now = new Date()): string {
  const today = localReportDay(now, COMPANY_TIMEZONE);
  return new URLSearchParams({
    desde: addDays(today, 1 - days),
    hasta: addDays(today, 1),
  }).toString();
}

/** Últimos 7 o 30 días incluido hoy. */
export function periodQuery(period: SummaryPeriod, now = new Date()): string {
  return lastDaysQuery(period === '7d' ? 7 : 30, now);
}

/** Misma clave que la pantalla de Cumplimiento: comparten caché para el mismo período. */
export function useComplianceReport(period: SummaryPeriod) {
  const query = periodQuery(period);
  return useQuery({
    queryKey: ['reports', 'rounds', query],
    queryFn: () => apiGet(`/reportes/rondas?${query}`, reportResponseSchema),
  });
}

export function useIncidentReport(period: SummaryPeriod) {
  const query = periodQuery(period);
  return useQuery({
    queryKey: ['reports', 'incidents', query],
    queryFn: () => apiGet(`/reportes/incidentes?${query}`, incidentReportResponseSchema),
  });
}

/** Casilleros predio × día de los últimos `days` días. */
export function useSiteDayGrid(days: number) {
  const query = lastDaysQuery(days);
  return useQuery({
    queryKey: ['reports', 'site-days', query],
    queryFn: () => apiGet(`/reportes/rondas/casilleros?${query}`, siteDayGridResponseSchema),
  });
}

/** Pendientes de toda la empresa: revisión, incidentes, sin sincronizar y turnos sin vigilador. */
export function useCompanyPending() {
  return useQuery({
    queryKey: ['reports', 'pending', undefined],
    queryFn: () => apiGet('/reportes/pendientes', reportPendingResponseSchema),
    refetchInterval: 30_000,
  });
}

/** Turnos de hoy, con la misma clave que En vivo. */
export function useShiftsToday() {
  return useQuery({
    queryKey: ['supervision', 'turnos'],
    queryFn: () => apiGet('/supervision/turnos', shiftListSchema),
    refetchInterval: 30_000,
  });
}
