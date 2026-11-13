import { z } from 'zod';
import { File, UploadType } from 'expo-file-system';
import { apiRequest } from '@/lib/api-client';
import { createDefaultFieldRepository } from '@/lib/db/database';
import { computeSyncBackoff } from '@/lib/cola/backoff';
import { deleteShiftCredential, getShiftCredentialToken } from '@/lib/cola/credential';

const authorizationSchema = z.object({
  cloudName: z.string(),
  apiKey: z.string(),
  publicId: z.string(),
  timestamp: z.number(),
  signature: z.string(),
  type: z.literal('authenticated'),
  uploadUrl: z.url(),
  maxBytes: z.number(),
});
const uploadResultSchema = z.object({
  public_id: z.string(),
  type: z.string(),
  width: z.number(),
  height: z.number(),
  bytes: z.number(),
});
const photoResultSchema = z.object({ id: z.string() });

let running = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export function resetIncidentPhotoQueueForTesting(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  running = false;
}

export async function processIncidentPhotos(): Promise<void> {
  if (running) return;
  running = true;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  try {
    const repository = await createDefaultFieldRepository();
    const photos = await repository.listIncidentPhotos();
    let nextRetryAt = Infinity;
    for (const photo of photos) {
      if (photo.nextAttemptAt && Date.parse(photo.nextAttemptAt) > Date.now()) {
        nextRetryAt = Math.min(nextRetryAt, Date.parse(photo.nextAttemptAt));
        continue;
      }
      const token = await getShiftCredentialToken();
      if (!token) continue;
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const authorization = await apiRequest(
          'POST',
          `/incidentes/${photo.incidentId}/fotos/autorizacion`,
          authorizationSchema,
          {},
          { headers },
        );
        const upload = await new File(photo.uri).upload(authorization.uploadUrl, {
          uploadType: UploadType.MULTIPART,
          fieldName: 'file',
          mimeType: 'image/jpeg',
          parameters: {
            api_key: authorization.apiKey,
            timestamp: String(authorization.timestamp),
            signature: authorization.signature,
            public_id: authorization.publicId,
            type: authorization.type,
            folder: `incidentes/${authorization.publicId.split('/')[1]}`,
            overwrite: 'false',
          },
        });
        if (upload.status < 200 || upload.status >= 300)
          throw new Error('Cloudinary rechazó la foto');
        const asset = uploadResultSchema.parse(JSON.parse(upload.body) as unknown);
        if (
          asset.public_id !== authorization.publicId ||
          asset.type !== 'authenticated' ||
          asset.bytes > authorization.maxBytes
        ) {
          throw new Error('La foto subida no coincide con la autorización');
        }
        await apiRequest(
          'POST',
          `/incidentes/${photo.incidentId}/fotos`,
          photoResultSchema,
          { publicId: asset.public_id },
          { headers },
        );
        await repository.removeIncidentPhoto(photo.photoId);
        new File(photo.uri).delete();
      } catch {
        const attempts = photo.attempts + 1;
        const waitSeconds = computeSyncBackoff(attempts - 1);
        const retryAt = Date.now() + waitSeconds * 1000;
        await repository.retryIncidentPhoto(
          photo.photoId,
          attempts,
          new Date(retryAt).toISOString(),
        );
        nextRetryAt = Math.min(nextRetryAt, retryAt);
      }
    }
    if (Number.isFinite(nextRetryAt))
      retryTimer = setTimeout(
        () => {
          retryTimer = null;
          void processIncidentPhotos();
        },
        Math.max(0, nextRetryAt - Date.now()),
      );
  } finally {
    running = false;
  }
  const repository = await createDefaultFieldRepository();
  if (
    (await repository.getSyncMeta('shift_closed_done')) === 'true' &&
    (await repository.countPendingEvents()) === 0 &&
    (await repository.listIncidentPhotos()).length === 0
  ) {
    await repository.clearShiftData();
    await deleteShiftCredential();
    await repository.setSyncMeta('shift_closed_done', 'false');
  }
}
