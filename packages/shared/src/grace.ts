import { z } from 'zod';

export const graceRetryResponseSchema = z
  .object({
    initPoint: z.url(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export const gracePaymentMethodResponseSchema = z.object({ url: z.url() }).strict();
export const graceRetryRequestSchema = z.object({}).strict();
export type GraceRetryResponse = z.infer<typeof graceRetryResponseSchema>;
