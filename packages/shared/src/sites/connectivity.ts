import { z } from 'zod';
import { SHIFT_START_MARGIN_MINUTES } from '../field/shift-execution';

export const siteConnectivitySchema = z
  .object({
    type: z.enum(['with_signal', 'without_signal']),
    minutesToSignal: z.number().int().min(0).max(720),
    marginMinutes: z.number().int().min(0).max(180).default(30),
  })
  .superRefine((conn, ctx) => {
    if (conn.type === 'without_signal' && conn.minutesToSignal === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['minutesToSignal'],
        message: 'Sin señal, el tiempo hasta zona con señal debe ser mayor que 0',
      });
  })
  .transform((conn) => ({
    ...conn,
    minutesToSignal: conn.type === 'with_signal' ? 0 : conn.minutesToSignal,
  }));

export type SiteConnectivity = z.infer<typeof siteConnectivitySchema>;

export function computeStartWindow(startsAt: Date, conn: SiteConnectivity): Date {
  const minutes =
    conn.type === 'with_signal'
      ? SHIFT_START_MARGIN_MINUTES
      : conn.minutesToSignal + conn.marginMinutes;
  return new Date(startsAt.getTime() - minutes * 60_000);
}

export function computeSyncDeadline(endsAt: Date, conn: SiteConnectivity): Date {
  return new Date(
    endsAt.getTime() +
      ((conn.type === 'with_signal' ? 0 : conn.minutesToSignal) + conn.marginMinutes) * 60_000,
  );
}

export const connectivitySimulationQuerySchema = z
  .object({
    inicio: z.iso.datetime({ offset: true }),
    fin: z.iso.datetime({ offset: true }),
  })
  .refine(({ inicio, fin }) => Date.parse(fin) > Date.parse(inicio), {
    path: ['fin'],
    message: 'El fin debe ser posterior al inicio',
  });

export const connectivitySimulationResponseSchema = z.object({
  startFrom: z.iso.datetime({ offset: true }),
  syncDeadline: z.iso.datetime({ offset: true }),
});
