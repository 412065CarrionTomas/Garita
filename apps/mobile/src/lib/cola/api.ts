import {
  connectionNoticeRequestSchema,
  connectionNoticeResponseSchema,
  syncBatchRequestSchema,
  syncBatchResponseSchema,
  type ConnectionNoticeRequest,
  type ConnectionNoticeResponse,
  type SyncBatchRequest,
  type SyncBatchResponse,
} from '@garita/shared';
import { apiRequest } from '@/lib/api-client';

export function sendSyncBatch(
  request: SyncBatchRequest,
  credentialToken?: string | null,
): Promise<SyncBatchResponse> {
  const body = syncBatchRequestSchema.parse(request);
  const headers: Record<string, string> = {};
  if (credentialToken) {
    headers['Authorization'] = `Bearer ${credentialToken}`;
  }
  return apiRequest(
    'POST',
    '/sincronizacion/eventos',
    syncBatchResponseSchema,
    body,
    Object.keys(headers).length > 0 ? { headers } : undefined,
  );
}

export function sendConnectionNotice(
  request: ConnectionNoticeRequest,
  credentialToken?: string | null,
): Promise<ConnectionNoticeResponse> {
  const body = connectionNoticeRequestSchema.parse(request);
  const headers: Record<string, string> = {};
  if (credentialToken) {
    headers['Authorization'] = `Bearer ${credentialToken}`;
  }
  return apiRequest(
    'POST',
    '/avisos-conexion',
    connectionNoticeResponseSchema,
    body,
    Object.keys(headers).length > 0 ? { headers } : undefined,
  );
}
