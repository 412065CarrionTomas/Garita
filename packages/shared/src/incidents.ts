import { z } from 'zod';
import { fieldLocationSchema } from './field/shift-execution';
import { deviceClockSchema } from './field/trusted-time';

export const INCIDENT_TYPES = [
  'intrusion',
  'suspicious_person',
  'suspicious_vehicle',
  'property_damage',
  'open_or_forced_access',
  'utility_failure',
  'accident',
  'other',
] as const;

export const INCIDENT_TYPE_LABELS: Record<(typeof INCIDENT_TYPES)[number], string> = {
  intrusion: 'Intrusión',
  suspicious_person: 'Persona sospechosa',
  suspicious_vehicle: 'Vehículo sospechoso',
  property_damage: 'Daño a la propiedad',
  open_or_forced_access: 'Acceso abierto o forzado',
  utility_failure: 'Falla de servicios',
  accident: 'Accidente',
  other: 'Otro',
};

export const incidentReportSchema = z
  .object({
    incidentId: z.uuid(),
    shiftId: z.string().min(1),
    type: z.enum(INCIDENT_TYPES),
    description: z.string().max(1000).optional(),
    occurredAtDevice: z.iso.datetime({ offset: true }),
    clock: deviceClockSchema.optional(),
    location: fieldLocationSchema,
    photoCount: z.number().int().min(0).max(5),
  })
  .refine((incident) => incident.type !== 'other' || Boolean(incident.description?.trim()), {
    path: ['description'],
    message: 'La descripción es obligatoria para el tipo Otro',
  });
export type IncidentReport = z.infer<typeof incidentReportSchema>;

export const incidentResponseSchema = z.object({
  incidentId: z.uuid(),
  classificationStatus: z.literal('pending'),
});

export const INCIDENT_CLASSIFICATIONS = ['client_visible', 'internal'] as const;
export const incidentClassificationSchema = z
  .object({
    classification: z.enum(INCIDENT_CLASSIFICATIONS),
    internalComment: z.string().trim().min(5).max(1000),
    clientNote: z.string().trim().max(500).optional(),
  })
  .strict();
export const incidentReclassificationSchema = incidentClassificationSchema.extend({
  reason: z.string().trim().min(5).max(500),
});
export const incidentListQuerySchema = z
  .object({
    predio: z.string().min(1).optional(),
    desde: z.iso.date().optional(),
    hasta: z.iso.date().optional(),
    tipo: z.enum(INCIDENT_TYPES).optional(),
    clasificacion: z.enum(['pending', ...INCIDENT_CLASSIFICATIONS]).optional(),
    pagina: z.coerce.number().int().min(1).default(1),
  })
  .strict();
