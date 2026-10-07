import type { z } from 'zod';

import { env } from '@/config/env';

export class ApiError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** GET a la API de Garita. La respuesta se valida con el esquema compartido antes de usarse. */
export async function apiGet<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
  init?: RequestInit,
): Promise<z.infer<TSchema>> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');

  const response = await fetch(`${env.EXPO_PUBLIC_API_URL}${path}`, { ...init, headers });

  if (!response.ok) {
    throw new ApiError(`La API respondió con el estado ${response.status}`, response.status);
  }

  const result = schema.safeParse(await response.json());

  if (!result.success) {
    throw new ApiError('La respuesta de la API no tiene el formato esperado');
  }

  return result.data;
}
