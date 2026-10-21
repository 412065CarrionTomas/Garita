import { createHash, randomUUID } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../../config/env';

export const PHOTO_STORAGE_PORT = Symbol('PHOTO_STORAGE_PORT');
export const INCIDENT_PHOTO_MAX_BYTES = 3 * 1024 * 1024;

export interface PhotoStoragePort {
  authorizeUpload(
    companyId: string,
    incidentId: string,
  ): Promise<{
    cloudName: string;
    apiKey: string;
    publicId: string;
    timestamp: number;
    signature: string;
    type: 'authenticated';
    uploadUrl: string;
  }>;
  inspectUpload(publicId: string): Promise<{ width: number; height: number; bytes: number } | null>;
}

const uploadedAssetSchema = z.object({
  public_id: z.string(),
  type: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
});

@Injectable()
export class CloudinaryPhotoStorage implements PhotoStoragePort {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private credentials() {
    const cloudName = this.config.get('CLOUDINARY_CLOUD_NAME', { infer: true });
    const apiKey = this.config.get('CLOUDINARY_API_KEY', { infer: true });
    const apiSecret = this.config.get('CLOUDINARY_API_SECRET', { infer: true });
    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException('La subida de fotos no está configurada');
    }
    return { cloudName, apiKey, apiSecret };
  }

  authorizeUpload(
    companyId: string,
    incidentId: string,
  ): Promise<{
    cloudName: string;
    apiKey: string;
    publicId: string;
    timestamp: number;
    signature: string;
    type: 'authenticated';
    uploadUrl: string;
  }> {
    const { cloudName, apiKey, apiSecret } = this.credentials();
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `incidentes/${companyId}/${incidentId}/${randomUUID()}`;
    const params = {
      folder: `incidentes/${companyId}`,
      overwrite: 'false',
      public_id: publicId,
      timestamp,
      type: 'authenticated',
    };
    const signature = createHash('sha1')
      .update(
        `${Object.entries(params)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => `${key}=${value}`)
          .join('&')}${apiSecret}`,
      )
      .digest('hex');
    return Promise.resolve({
      cloudName,
      apiKey,
      publicId,
      timestamp,
      signature,
      type: 'authenticated' as const,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    });
  }

  async inspectUpload(publicId: string) {
    const { cloudName, apiKey, apiSecret } = this.credentials();
    const url = new URL(
      `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/authenticated/${publicId.split('/').map(encodeURIComponent).join('/')}`,
    );
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
      },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Cloudinary no pudo verificar la foto');
    const asset = uploadedAssetSchema.parse(await response.json());
    if (
      asset.public_id !== publicId ||
      asset.type !== 'authenticated' ||
      asset.bytes > INCIDENT_PHOTO_MAX_BYTES
    ) {
      throw new Error('La foto no cumple las condiciones de seguridad');
    }
    return { width: asset.width, height: asset.height, bytes: asset.bytes };
  }
}
