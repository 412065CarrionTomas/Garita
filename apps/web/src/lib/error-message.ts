import { ApiError } from './api-client';

/** Mensaje legible para mostrar al usuario cuando falla una llamada a la API. */
export function errorMessage(error: unknown, conflictMessage?: string): string {
  if (error instanceof ApiError && error.status === 409 && conflictMessage) return conflictMessage;
  return error instanceof Error ? error.message : 'No se pudo completar la operación';
}
