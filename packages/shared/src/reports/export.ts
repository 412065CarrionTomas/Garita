import { z } from 'zod';

export const REPORT_EXPORT_PERIOD_MESSAGE = 'El período máximo para exportar es de 3 meses';

/** Misma semántica que las pantallas: inicio incluido y fin excluido. */
export function isReportExportPeriodAllowed(desde: string, hasta: string): boolean {
  if (!z.iso.date().safeParse(desde).success || !z.iso.date().safeParse(hasta).success)
    return false;
  const limit = new Date(`${desde}T00:00:00Z`);
  const day = limit.getUTCDate();
  limit.setUTCDate(1);
  limit.setUTCMonth(limit.getUTCMonth() + 3);
  const lastDay = new Date(
    Date.UTC(limit.getUTCFullYear(), limit.getUTCMonth() + 1, 0),
  ).getUTCDate();
  limit.setUTCDate(Math.min(day, lastDay));
  return desde < hasta && hasta <= limit.toISOString().slice(0, 10);
}

export const reportExportHeaderSchema = z.strictObject({
  company: z.string(),
  clients: z.array(z.string()),
  sites: z.array(z.string()),
});
export type ReportExportHeader = z.infer<typeof reportExportHeaderSchema>;
