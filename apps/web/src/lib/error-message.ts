import { ApiError } from './api-client';

/** Mensaje legible para mostrar al usuario cuando falla una llamada a la API. */
export function errorMessage(error: unknown, conflictMessage?: string): string {
  if (error instanceof ApiError && error.status === 409 && conflictMessage) return conflictMessage;
  // fetch lanza TypeError cuando no hay conexión; su mensaje original está en inglés.
  if (error instanceof TypeError)
    return 'No pudimos conectar con el servidor. Revisá tu conexión e intentá de nuevo.';
  // Mensaje en español que envía el backend (Nest: { message: string | string[] }).
  // Se excluyen 401/403 y 5xx: Nest los devuelve con textos genéricos en inglés.
  if (
    error instanceof ApiError &&
    error.status !== undefined &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 401 &&
    error.status !== 403 &&
    typeof error.body === 'object' &&
    error.body !== null
  ) {
    const { message } = error.body as { message?: unknown };
    if (typeof message === 'string' && message) return message;
  }
  return error instanceof Error ? error.message : 'No se pudo completar la operación';
}
