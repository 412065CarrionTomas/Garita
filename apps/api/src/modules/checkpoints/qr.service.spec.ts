import * as crypto from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import { QrService } from './qr.service';

describe('QrService', () => {
  const findFirst = jest.fn();
  const prisma = {
    tenantPrisma: { checkpoint: { findFirst } },
  } as unknown as PrismaService;
  const config = {
    get: () => 'fixed-test-qr-signing-secret-with-32-chars',
  } as unknown as ConfigService;
  const constantTimeCompare = jest.fn(crypto.timingSafeEqual);
  let service: QrService;

  beforeEach(() => {
    findFirst.mockReset();
    constantTimeCompare.mockClear();
    service = new QrService(
      config as unknown as ConfigService<never, true>,
      prisma,
      constantTimeCompare,
    );
  });

  it('verifies a signed active checkpoint', async () => {
    findFirst.mockResolvedValue({ id: 'point-1', siteId: 'site-1', qrVersion: 1 });
    const payload = service.createPayload('point-1', 1);
    await expect(service.verifyQrPayload(payload)).resolves.toEqual({
      valid: true,
      checkpoint: { id: 'point-1', siteId: 'site-1', qrVersion: 1 },
    });
  });

  it('rejects altered signatures and malformed QR contents', async () => {
    const payload = service.createPayload('point-1', 1);
    const signatureStart = payload.lastIndexOf('.') + 1;
    const firstSignatureCharacter = payload[signatureStart];
    const altered = `${payload.slice(0, signatureStart)}${
      firstSignatureCharacter === 'A' ? 'B' : 'A'
    }${payload.slice(signatureStart + 1)}`;
    await expect(service.verifyQrPayload(altered)).resolves.toEqual({
      valid: false,
      reason: 'signature',
    });
    await expect(service.verifyQrPayload('GQR1.point-1.nope.invalid')).resolves.toEqual({
      valid: false,
      reason: 'malformed',
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('uses the runtime constant-time comparator for equal length signatures', async () => {
    findFirst.mockResolvedValue(null);
    await service.verifyQrPayload(service.createPayload('point-1', 1));
    expect(constantTimeCompare).toHaveBeenCalledTimes(1);
  });

  it('rejects a signature from an outdated QR version', async () => {
    findFirst.mockResolvedValue({ id: 'point-1', siteId: 'site-1', qrVersion: 2 });
    await expect(service.verifyQrPayload(service.createPayload('point-1', 1))).resolves.toEqual({
      valid: false,
      reason: 'outdated',
    });
  });
});
