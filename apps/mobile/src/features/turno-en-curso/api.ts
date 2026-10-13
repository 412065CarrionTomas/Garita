import {
  closeShiftRequestSchema,
  closeShiftResponseSchema,
  SHIFT_EXECUTION_ERROR_CODES,
  shiftStateResponseSchema,
  startShiftRequestSchema,
  startShiftResponseSchema,
  type CloseShiftRequest,
  type ShiftExecutionErrorCode,
  type StartShiftRequest,
} from '@garita/shared';
import { ApiError, apiRequest } from '@/lib/api-client';

export class ShiftExecutionApiError extends Error {
  constructor(readonly code: ShiftExecutionErrorCode | undefined) {
    super('No se pudo completar la operación del turno.');
    this.name = 'ShiftExecutionApiError';
  }
}

function getExecutionError(error: unknown): ShiftExecutionApiError | null {
  if (!(error instanceof ApiError)) return null;
  const payload = error.payload;
  if (typeof payload !== 'object' || payload === null || !('code' in payload)) return null;
  const code = payload.code;
  const knownCodes = Object.values(SHIFT_EXECUTION_ERROR_CODES);
  return new ShiftExecutionApiError(
    typeof code === 'string' && knownCodes.includes(code as ShiftExecutionErrorCode)
      ? (code as ShiftExecutionErrorCode)
      : undefined,
  );
}

async function request<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const executionError = getExecutionError(error);
    if (executionError) throw executionError;
    throw error;
  }
}

export function startShift(shiftId: string, input: StartShiftRequest) {
  const body = startShiftRequestSchema.parse(input);
  return request(() =>
    apiRequest(
      'POST',
      `/turnos/${encodeURIComponent(shiftId)}/iniciar`,
      startShiftResponseSchema,
      body,
    ),
  );
}

export function closeShift(shiftId: string, input: CloseShiftRequest) {
  const body = closeShiftRequestSchema.parse(input);
  return request(() =>
    apiRequest(
      'POST',
      `/turnos/${encodeURIComponent(shiftId)}/cerrar`,
      closeShiftResponseSchema,
      body,
    ),
  );
}

export function getShiftState(shiftId: string) {
  return apiRequest(
    'GET',
    `/turnos/${encodeURIComponent(shiftId)}/estado`,
    shiftStateResponseSchema,
  );
}
