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
  status: z.enum(['scheduled', 'unassigned', 'cancelled', 'cancelled_by_suspension']),
});

/** Grupos de estado del listado de turnos: lo que el supervisor busca, no el enum crudo. */
export const SHIFT_LIST_STATES = {
  programado: ['scheduled'],
  en_curso: ['in_progress'],
  finalizado: ['closed', 'auto_closed'],
  problema: ['unassigned', 'uncovered', 'no_show'],
  cancelado: ['cancelled', 'cancelled_by_suspension'],
} as const;
export type ShiftListState = keyof typeof SHIFT_LIST_STATES;

export const SHIFT_LIST_ORDERS = [
  'inicio:asc',
  'inicio:desc',
  'predio:asc',
  'predio:desc',
] as const;

export const shiftListQuerySchema = z.object({
  predio: z.string().min(1).optional(),
  vigilador: z.string().min(1).optional(),
  desde: isoDateTime.optional(),
  hasta: isoDateTime.optional(),
  estado: z
    .enum(Object.keys(SHIFT_LIST_STATES) as [ShiftListState, ...ShiftListState[]])
    .optional(),
  q: z.string().trim().max(100).optional(),
  orden: z.enum(SHIFT_LIST_ORDERS).default('inicio:desc'),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(25),
});
export type ShiftListQuery = z.infer<typeof shiftListQuerySchema>;

export type ShiftInput = z.infer<typeof shiftInputSchema>;
export type ShiftOutput = z.infer<typeof shiftOutputSchema>;
