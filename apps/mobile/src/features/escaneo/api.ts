import {
  checkpointRecordRequestSchema,
  checkpointRecordResponseSchema,
  type CheckpointRecordRequest,
  type CheckpointRecordResponse,
} from '@garita/shared';
import { apiRequest } from '@/lib/api-client';

export function sendCheckpointRecord(
  input: CheckpointRecordRequest,
): Promise<CheckpointRecordResponse> {
  const body = checkpointRecordRequestSchema.parse(input);
  return apiRequest('POST', '/registros-puntos', checkpointRecordResponseSchema, body);
}
