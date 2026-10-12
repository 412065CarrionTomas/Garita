import type { z } from 'zod';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { authMeResponseSchema } from '@garita/shared';

import { env } from '@/config/env';

export class ApiError extends Error {
  readonly status: number | undefined;
  readonly body: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'PUT';

/** Llama a Garita con el token Firebase vigente y valida toda respuesta con Zod. */
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
  const hasBody = body !== undefined;
  if (hasBody) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${env.VITE_API_URL}${path}`, {
    ...init,
    method,
    headers,
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    if (response.status === 401) {
      await expireSession('Tu sesión venció. Ingresá nuevamente.');
    } else if (response.status === 403 && path.endsWith('/auth/me')) {
      await expireSession(
        'Tu usuario no está habilitado. Si recibiste una invitación, activala desde el enlace del correo; si no, contactá a tu administrador',
      );
    } else if (response.status === 403) {
      // Un 403 de permisos no implica una cuenta desactivada: confirmalo con /auth/me.
      try {
        await apiRequest('GET', '/auth/me', authMeResponseSchema);
      } catch (profileError) {
        if (
          profileError instanceof ApiError &&
          (profileError.status === 401 || profileError.status === 403)
        )
          throw profileError;
      }
    }
    let errorBody: unknown;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = undefined;
    }
    throw new ApiError(
      `La API respondió con el estado ${response.status}`,
      response.status,
      errorBody,
    );
  }
  const result = schema.safeParse(await response.json());
  if (!result.success) throw new ApiError('La respuesta de la API no tiene el formato esperado');
  return result.data;
}

/** Descarga un archivo autenticado sin asumir que la respuesta es JSON. */
export async function apiDownload(path: string): Promise<Blob> {
  const headers = new Headers({ Accept: 'application/pdf' });
  const token = await auth.currentUser?.getIdToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${env.VITE_API_URL}${path}`, { headers });
  if (!response.ok)
    throw new ApiError(`La API respondió con el estado ${response.status}`, response.status);
  return response.blob();
}

async function expireSession(message: string) {
  window.dispatchEvent(new CustomEvent('garita:auth-error', { detail: message }));
  await signOut(auth);
}

/** GET a la API de Garita. La respuesta se valida con el esquema compartido antes de usarse. */
export async function apiGet<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
  init?: RequestInit,
): Promise<z.infer<TSchema>> {
  return apiRequest('GET', path, schema, undefined, init);
}

async function apiWrite<TResponse extends z.ZodType>(
  method: Exclude<ApiMethod, 'GET'>,
  path: string,
  body: unknown,
  requestSchema: z.ZodType,
  responseSchema: TResponse,
  init?: RequestInit,
): Promise<z.infer<TResponse>> {
  const parsedBody = requestSchema.safeParse(body);
  if (!parsedBody.success) throw new ApiError('La solicitud no tiene el formato esperado');
  return apiRequest(method, path, responseSchema, parsedBody.data, init);
}

export const apiPost = <TResponse extends z.ZodType>(
  path: string,
  body: unknown,
  requestSchema: z.ZodType,
  responseSchema: TResponse,
  init?: RequestInit,
): Promise<z.infer<TResponse>> => {
  return apiWrite('POST', path, body, requestSchema, responseSchema, init);
};
export const apiPatch = <TResponse extends z.ZodType>(
  path: string,
  body: unknown,
  requestSchema: z.ZodType,
  responseSchema: TResponse,
  init?: RequestInit,
): Promise<z.infer<TResponse>> => {
  return apiWrite('PATCH', path, body, requestSchema, responseSchema, init);
};
export const apiPut = <TResponse extends z.ZodType>(
  path: string,
  body: unknown,
  requestSchema: z.ZodType,
  responseSchema: TResponse,
  init?: RequestInit,
): Promise<z.infer<TResponse>> => {
  return apiWrite('PUT', path, body, requestSchema, responseSchema, init);
};
