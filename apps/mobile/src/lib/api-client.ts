import type { z } from 'zod';
import { auth } from '@/lib/firebase';
import { env } from '@/config/env';

export class ApiError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'PUT';
export async function apiRequest<TSchema extends z.ZodType>(
  method: ApiMethod,
  path: string,
  schema: TSchema,
  body?: unknown,
  init?: RequestInit,
): Promise<z.infer<TSchema>> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  const token = await auth.currentUser?.getIdToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${env.EXPO_PUBLIC_API_URL}${path}`, {
    ...init,
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new ApiError(`La API respondió con el estado ${response.status}`, response.status);
  const result = schema.safeParse(await response.json());
  if (!result.success) throw new ApiError('La respuesta de la API no tiene el formato esperado');
  return result.data;
}
export function apiGet<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
  init?: RequestInit,
) {
  return apiRequest('GET', path, schema, undefined, init);
}
