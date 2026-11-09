import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** Parses external input; a Zod error left uncaught would reach the client as a 500. */
export function parseOrBadRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('Los datos enviados no son válidos');
  return result.data;
}
