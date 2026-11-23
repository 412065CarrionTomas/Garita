import { useQuery } from '@tanstack/react-query';
import { panicAlertSummarySchema } from '@garita/shared';
import { z } from 'zod';
import { apiGet } from '@/lib/api-client';

export const panicListSchema = z.object({
  items: z.array(panicAlertSummarySchema),
  total: z.number(),
  activeCount: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export const panicStatuses = {
  active: 'Activa',
  confirmed: 'Confirmada',
  resolved: 'Resuelta',
} as const;
export const panicOutcomes = {
  real_emergency: 'Emergencia real',
  false_alarm: 'Falsa alarma',
  test: 'Prueba',
} as const;

export function useActivePanicAlerts(enabled: boolean) {
  return useQuery({
    queryKey: ['panico', 'active'],
    queryFn: () => apiGet('/alertas-panico?estado=active', panicListSchema),
    // Ante un error (p. ej. 500) se espacia el polling para no saturar la API.
    refetchInterval: (query) => (query.state.status === 'error' ? 60_000 : 15_000),
    enabled,
  });
}
