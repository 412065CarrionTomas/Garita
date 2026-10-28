import { ApiError } from './api-client';

/** Mensaje legible para mostrar al usuario cuando falla una llamada a la API. */
export function errorMessage(error: unknown, conflictMessage?: string): string {
  if (error instanceof ApiError && error.status === 409 && conflictMessage) return conflictMessage;
  // fetch lanza TypeError cuando no hay conexión; su mensaje original está en inglés.
  if (error instanceof TypeError)
    return 'No pudimos conectar con el servidor. Revisá tu conexión e intentá de nuevo.';
  return error instanceof Error ? error.message : 'No se pudo completar la operación';
}
