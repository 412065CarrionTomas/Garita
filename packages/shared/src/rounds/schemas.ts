import { z } from 'zod';
import { validateWindowConfig } from './windows';

export const roundInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    checkpointIds: z.array(z.string().min(1)).min(1),
    frequencyMinutes: z.number().int(),
    windowStartLocal: z.string(),
    windowEndLocal: z.string(),
    graceMinutes: z.number().int(),
  })
  .superRefine((value, context) => {
    for (const { field, message } of validateWindowConfig(value))
      context.addIssue({ code: 'custom', message, path: [field] });
    if (new Set(value.checkpointIds).size !== value.checkpointIds.length)
      context.addIssue({
        code: 'custom',
        message: 'No se pueden repetir puntos.',
        path: ['checkpointIds'],
      });
  });

export const previewRoundSchema = z
  .object({
    frequencyMinutes: z.number().int(),
    windowStartLocal: z.string(),
    windowEndLocal: z.string(),
    graceMinutes: z.number().int(),
  })
  .superRefine((value, context) => {
    for (const { field, message } of validateWindowConfig(value))
      context.addIssue({ code: 'custom', message, path: [field] });
  });
