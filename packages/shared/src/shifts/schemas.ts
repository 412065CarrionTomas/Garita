import { z } from 'zod';

const isoDateTime = z.iso.datetime({ offset: true });

export const shiftInputSchema = z
  .object({
    siteId: z.string().min(1),
    guardId: z.string().min(1).nullable(),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    roundIds: z.array(z.string().min(1)).min(1),
  })
  .superRefine((value, context) => {
    const duration = Date.parse(value.endsAt) - Date.parse(value.startsAt);
    if (duration < 60 * 60 * 1000 || duration > 24 * 60 * 60 * 1000)
      context.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'El turno debe durar de 1 a 24 horas.',
      });
    if (new Set(value.roundIds).size !== value.roundIds.length)
      context.addIssue({
        code: 'custom',
        path: ['roundIds'],
        message: 'No se pueden repetir rondas.',
      });
  });

export const shiftOutputSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  companyId: z.string(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  serviceDate: z.iso.date(),
  status: z.enum(['scheduled', 'unassigned', 'cancelled']),
});

export type ShiftInput = z.infer<typeof shiftInputSchema>;
export type ShiftOutput = z.infer<typeof shiftOutputSchema>;
