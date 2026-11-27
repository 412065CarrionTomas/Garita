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
export const INCIDENT_CLASSIFICATION_LABELS: Record<
  'pending' | (typeof INCIDENT_CLASSIFICATIONS)[number],
  string
> = {
  pending: 'Sin clasificar',
  client_visible: 'Visible al cliente',
  internal: 'Interno',
};

export const INCIDENT_SEVERITIES = ['low', 'medium', 'high'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export const INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
};

export const INCIDENT_FOLLOW_UP_STATUSES = ['none', 'open', 'closed'] as const;
export type IncidentFollowUpStatus = (typeof INCIDENT_FOLLOW_UP_STATUSES)[number];
export const INCIDENT_FOLLOW_UP_LABELS: Record<IncidentFollowUpStatus, string> = {
  none: 'Sin seguimiento',
  open: 'Seguimiento abierto',
  closed: 'Seguimiento cerrado',
};

export const incidentClassificationSchema = z
  .object({
    classification: z.enum(INCIDENT_CLASSIFICATIONS),
    severity: z.enum(INCIDENT_SEVERITIES),
    requiresFollowUp: z.boolean().default(false),
    internalComment: z.string().trim().min(5).max(1000),
    clientNote: z.string().trim().max(500).optional(),
  })
  .strict();
export type IncidentClassificationInput = z.infer<typeof incidentClassificationSchema>;
export const incidentReclassificationSchema = incidentClassificationSchema.extend({
  reason: z.string().trim().min(5).max(500),
});

export const INCIDENT_SORT_FIELDS = ['fecha', 'tipo', 'predio', 'gravedad'] as const;
export const incidentListQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    predio: z.string().min(1).optional(),
    desde: z.iso.date().optional(),
    hasta: z.iso.date().optional(),
    tipo: z.enum(INCIDENT_TYPES).optional(),
    clasificacion: z.enum(['pending', ...INCIDENT_CLASSIFICATIONS]).optional(),
    gravedad: z.enum(INCIDENT_SEVERITIES).optional(),
    seguimiento: z.enum(INCIDENT_FOLLOW_UP_STATUSES).optional(),
    orden: z
      .string()
      .regex(new RegExp(`^(${INCIDENT_SORT_FIELDS.join('|')}):(asc|desc)$`))
      .optional(),
    pagina: z.coerce.number().int().min(1).default(1),
    porPagina: z.coerce.number().int().min(10).max(100).default(25),
  })
  .strict();
export type IncidentListQuery = z.infer<typeof incidentListQuerySchema>;

const isoDate = z.coerce.date();
const siteRefSchema = z.object({ id: z.string(), name: z.string() });

export const incidentListItemSchema = z.object({
  id: z.string(),
  type: z.enum(INCIDENT_TYPES),
  description: z.string().nullable(),
  occurredAt: isoDate,
  createdAt: isoDate,
  classificationStatus: z.enum(['pending', ...INCIDENT_CLASSIFICATIONS]),
  severity: z.enum(INCIDENT_SEVERITIES).nullable(),
  followUpStatus: z.enum(INCIDENT_FOLLOW_UP_STATUSES),
  photoCount: z.number().int(),
  site: siteRefSchema,
  guardName: z.string(),
  /** Pendiente hace más de 24 h. */
  overdue: z.boolean(),
  ageMs: z.number(),
});
export type IncidentListItem = z.infer<typeof incidentListItemSchema>;

export const incidentListResponseSchema = z.object({
  items: z.array(incidentListItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  timezone: z.string(),
  counts: z.object({
    pending: z.number().int(),
    high: z.number().int(),
    followUpOpen: z.number().int(),
  }),
});
export type IncidentListResponse = z.infer<typeof incidentListResponseSchema>;

export const incidentQueueResponseSchema = z.object({
  items: z.array(incidentListItemSchema),
  timezone: z.string(),
});
export type IncidentQueueResponse = z.infer<typeof incidentQueueResponseSchema>;

export const INCIDENT_FOLLOW_UP_ACTION_KINDS = ['note', 'close', 'reopen'] as const;
export const incidentFollowUpActionInputSchema = z
  .object({ text: z.string().trim().min(3).max(1000) })
  .strict();

export const incidentTimelineEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('classification'),
    id: z.string(),
    at: isoDate,
    author: z.string(),
    classification: z.enum(INCIDENT_CLASSIFICATIONS),
    severity: z.enum(INCIDENT_SEVERITIES).nullable(),
    requiresFollowUp: z.boolean(),
    internalComment: z.string(),
    clientNote: z.string().nullable(),
    reason: z.string().nullable(),
  }),
  z.object({
    kind: z.enum(INCIDENT_FOLLOW_UP_ACTION_KINDS),
    id: z.string(),
    at: isoDate,
    author: z.string(),
    text: z.string(),
  }),
]);
export type IncidentTimelineEntry = z.infer<typeof incidentTimelineEntrySchema>;

export const incidentDetailSchema = z.object({
  id: z.string(),
  type: z.enum(INCIDENT_TYPES),
  description: z.string().nullable(),
  occurredAt: isoDate,
  receivedAt: isoDate,
  classificationStatus: z.enum(['pending', ...INCIDENT_CLASSIFICATIONS]),
  severity: z.enum(INCIDENT_SEVERITIES).nullable(),
  followUpStatus: z.enum(INCIDENT_FOLLOW_UP_STATUSES),
  timezone: z.string(),
  site: siteRefSchema,
  guardName: z.string(),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      accuracyMeters: z.number().nullable(),
    })
    .nullable(),
  photos: z.array(z.object({ id: z.string(), thumbnailUrl: z.string(), fullUrl: z.string() })),
  timeline: z.array(incidentTimelineEntrySchema),
  shiftContext: z.object({
    shiftId: z.string(),
    startsAt: isoDate,
    endsAt: isoDate,
    roundName: z.string().nullable(),
    lastCheckpoint: z.object({ name: z.string(), at: isoDate }).nullable(),
  }),
  relatedIncidents: z.array(
    z.object({ id: z.string(), type: z.enum(INCIDENT_TYPES), occurredAt: isoDate }),
  ),
});
export type IncidentDetail = z.infer<typeof incidentDetailSchema>;
