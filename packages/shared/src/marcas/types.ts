import { z } from 'zod';

export const RECORD_FLAG_TYPES = [
  'out_of_range',
  'simulated_location',
  'impossible_time',
  'location_disabled',
  'qr_on_tagged_point',
  'location_unverifiable',
] as const;
export type RecordFlagType = (typeof RECORD_FLAG_TYPES)[number];
export const recordFlagTypeSchema = z.enum(RECORD_FLAG_TYPES);

export const RECORD_FLAG_SEVERITIES = ['grave', 'media', 'leve'] as const;
export type RecordFlagSeverity = (typeof RECORD_FLAG_SEVERITIES)[number];
export const recordFlagSeveritySchema = z.enum(RECORD_FLAG_SEVERITIES);

export const FLAG_SEVERITY: Record<RecordFlagType, RecordFlagSeverity> = {
  simulated_location: 'grave',
  impossible_time: 'grave',
  out_of_range: 'media',
  location_disabled: 'media',
  qr_on_tagged_point: 'media',
  location_unverifiable: 'leve',
};

export const SPEED_PROFILES = ['walking', 'bicycle', 'vehicle', 'custom'] as const;
export type SpeedProfile = (typeof SPEED_PROFILES)[number];
export const speedProfileSchema = z.enum(SPEED_PROFILES);

export const DEFAULT_SPEED_PROFILE: SpeedProfile = 'walking';
export const DEFAULT_SPEED_KMH = 10;
export const MIN_SPEED_KMH = 5;
export const MAX_SPEED_KMH = 120;

export const DEFAULT_SPEEDS_KMH: Record<Exclude<SpeedProfile, 'custom'>, number> = {
  walking: 10,
  bicycle: 25,
  vehicle: 60,
};

export const speedKmhSchema = z.coerce
  .number()
  .int()
  .min(MIN_SPEED_KMH, `La velocidad mínima permitida es ${MIN_SPEED_KMH} km/h`)
  .max(MAX_SPEED_KMH, `La velocidad máxima permitida es ${MAX_SPEED_KMH} km/h`);

export const updateSiteSpeedSchema = z
  .object({
    maxSpeedProfile: speedProfileSchema,
    maxSpeedKmh: speedKmhSchema.optional(),
  })
  .refine(
    (data) => {
      if (data.maxSpeedProfile === 'custom') {
        return data.maxSpeedKmh !== undefined;
      }
      return true;
    },
    {
      message: 'El perfil personalizado requiere indicar la velocidad en km/h',
      path: ['maxSpeedKmh'],
    },
  );
export type UpdateSiteSpeedInput = z.infer<typeof updateSiteSpeedSchema>;

export interface EvaluatedFlag {
  type: RecordFlagType;
  severity: RecordFlagSeverity;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface EvaluateRecordFlagsInput {
  record: {
    method: 'qr' | 'nfc';
    occurredAtDevice: string | Date;
    location: {
      status: 'ok' | 'unverifiable' | 'disabled';
      latitude: number | null;
      longitude: number | null;
      accuracyMeters: number | null;
      simulation: 'simulated' | 'not_simulated' | 'unavailable';
    };
    phoneNfc: 'on' | 'off' | 'unsupported';
  };
  checkpoint: {
    id: string;
    latitude: number;
    longitude: number;
    toleranceRadiusMeters: number;
    isIndoor: boolean;
    hasActiveNfcTag: boolean;
  };
  previousRecord?: {
    occurredAtDevice: string | Date;
    checkpoint: {
      id: string;
      latitude: number;
      longitude: number;
    };
  } | null;
  site: {
    maxSpeedKmh: number;
  };
}

export const flagResponseSchema = z.object({
  id: z.string(),
  type: recordFlagTypeSchema,
  severity: recordFlagSeveritySchema,
  reason: z.string().nullable().optional(),
  details: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.string(),
});
export type FlagResponse = z.infer<typeof flagResponseSchema>;

export const shiftRecordItemSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  shiftId: z.string(),
  checkpointId: z.string(),
  method: z.enum(['qr', 'nfc']),
  occurredAtDevice: z.string(),
  receivedAt: z.string(),
  locationStatus: z.enum(['ok', 'unverifiable', 'disabled']),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  accuracyMeters: z.number().nullable(),
  simulation: z.enum(['simulated', 'not_simulated', 'unavailable']),
  phoneNfc: z.enum(['on', 'off', 'unsupported']),
  outOfWindow: z.boolean(),
  countsForCompliance: z.boolean(),
  flags: z.array(flagResponseSchema),
});
export type ShiftRecordItem = z.infer<typeof shiftRecordItemSchema>;

export const shiftRecordsResponseSchema = z.object({
  shiftId: z.string(),
  phoneWithoutNfc: z.boolean(),
  records: z.array(shiftRecordItemSchema),
});
export type ShiftRecordsResponse = z.infer<typeof shiftRecordsResponseSchema>;
