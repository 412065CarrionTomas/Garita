import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { CloudinaryPhotoStorage } from './photo-storage.port';

describe('CloudinaryPhotoStorage', () => {
  const createConfig = (vars: Partial<Env> = {}) =>
    ({
      get: jest.fn((key: string) => {
        const envs: Record<string, string | undefined> = {
          CLOUDINARY_CLOUD_NAME: 'test-cloud',
          CLOUDINARY_API_KEY: 'test-api-key',
          CLOUDINARY_API_SECRET: 'test-api-secret',
          ...vars,
        };
        return envs[key];
      }),
    }) as unknown as ConfigService<Env, true>;

  it('genera una URL firmada de descarga para miniatura con transformaciones', () => {
    const storage = new CloudinaryPhotoStorage(createConfig());
    const urlString = storage.signedUrl('incident-photo-123', 'thumbnail');
    const url = new URL(urlString);

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('api.cloudinary.com');
    expect(url.pathname).toBe('/v1_1/test-cloud/image/download');
    expect(url.searchParams.get('public_id')).toBe('incident-photo-123');
    expect(url.searchParams.get('transformation')).toBe('c_limit,h_320,w_320');
    expect(url.searchParams.get('api_key')).toBe('test-api-key');
    expect(url.searchParams.get('type')).toBe('authenticated');
    expect(url.searchParams.get('format')).toBe('jpg');
    expect(url.searchParams.has('signature')).toBe(true);
    expect(url.searchParams.has('expires_at')).toBe(true);
  });

  it('genera una URL firmada de descarga para tamaño completo sin transformaciones', () => {
    const storage = new CloudinaryPhotoStorage(createConfig());
    const urlString = storage.signedUrl('incident-photo-123', 'full');
    const url = new URL(urlString);

    expect(url.searchParams.get('public_id')).toBe('incident-photo-123');
    expect(url.searchParams.has('transformation')).toBe(false);
    expect(url.searchParams.has('signature')).toBe(true);
  });

  it('lanza ServiceUnavailableException si faltan credenciales de Cloudinary', () => {
    const storage = new CloudinaryPhotoStorage(createConfig({ CLOUDINARY_CLOUD_NAME: undefined }));
    expect(() => storage.signedUrl('incident-photo-123', 'full')).toThrow(
      ServiceUnavailableException,
    );
  });
});
