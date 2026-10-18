import type { z } from 'zod';
import { auth } from '@/lib/firebase';
import { env } from '@/config/env';

export class ApiError extends Error {
  readonly status: number | undefined;
  readonly payload: unknown;
  constructor(message: string, status?: number, payload?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export async function apiRequest<TSchema extends z.ZodType>(
  method: ApiMethod,
  path: string,
  schema: TSchema,
  body?: unknown,
  init?: RequestInit,
): Promise<z.infer<TSchema>> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (!headers.has('Authorization')) {
    const token = await auth.currentUser?.getIdToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${env.EXPO_PUBLIC_API_URL}${path}`, {
    ...init,
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined);
    const detail =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? String(payload.message)
        : `La API respondió con el estado ${response.status}`;
    throw new ApiError(detail, response.status, payload);
  }
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

export function apiDelete<TSchema extends z.ZodType>(path: string, schema: TSchema) {
  return apiRequest('DELETE', path, schema);
}
