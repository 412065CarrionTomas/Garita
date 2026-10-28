import { z } from 'zod';
import { nfcTagUidSchema } from './nfc-tags';

export const secureTagStartSchema = z.object({
  uid: nfcTagUidSchema,
  version: z.string().regex(/^[0-9a-fA-F]{56}$/),
});
export const secureTagCommandSchema = z.object({
  response: z.string().regex(/^(?:[0-9a-fA-F]{2}){2,128}$/),
});
export const secureTagConfirmSchema = z.object({
  sdmMessage: z.string().min(1).max(512),
});
export const secureTagStepResponseSchema = z.object({
  sessionId: z.string(),
  apdu: z
    .string()
    .regex(/^(?:[0-9A-F]{2})+$/)
    .nullable(),
  complete: z.boolean(),
});

export type SecureTagStart = z.infer<typeof secureTagStartSchema>;
export type SecureTagCommand = z.infer<typeof secureTagCommandSchema>;
export type SecureTagConfirm = z.infer<typeof secureTagConfirmSchema>;
