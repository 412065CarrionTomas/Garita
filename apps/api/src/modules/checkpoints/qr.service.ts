import * as crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';

export type QrVerificationResult =
  | { valid: true; checkpoint: { id: string; siteId: string; qrVersion: number } }
  | { valid: false; reason: 'malformed' | 'signature' | 'outdated' | 'not_found' };

export const QR_CONSTANT_TIME_COMPARE = Symbol('QR_CONSTANT_TIME_COMPARE');
export type ConstantTimeCompare = (expected: Buffer, supplied: Buffer) => boolean;

@Injectable()
export class QrService {
  private readonly secret: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    @Inject(QR_CONSTANT_TIME_COMPARE) private readonly constantTimeCompare: ConstantTimeCompare,
  ) {
    const secret = config.get('QR_SIGNING_SECRET', { infer: true });
    if (!secret) throw new Error('QR_SIGNING_SECRET no está configurada');
    this.secret = secret;
  }

  createPayload(checkpointId: string, version: number): string {
    const signedContent = `GQR1.${checkpointId}.${version}`;
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(signedContent)
      .digest('base64url');
    return `${signedContent}.${signature}`;
  }

  async verifyQrPayload(payload: string): Promise<QrVerificationResult> {
    const parts = payload.split('.');
    if (
      parts.length !== 4 ||
      parts[0] !== 'GQR1' ||
      !parts[1] ||
      !/^[1-9]\d*$/.test(parts[2] ?? '') ||
      !/^[A-Za-z0-9_-]{43}$/.test(parts[3] ?? '')
    )
      return { valid: false, reason: 'malformed' };

    const signedContent = parts.slice(0, 3).join('.');
    const expected = crypto.createHmac('sha256', this.secret).update(signedContent).digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(parts[3] ?? '', 'base64url');
    } catch {
      return { valid: false, reason: 'malformed' };
    }
    if (supplied.toString('base64url') !== parts[3]) return { valid: false, reason: 'malformed' };
    if (supplied.length !== expected.length || !this.constantTimeCompare(expected, supplied))
      return { valid: false, reason: 'signature' };

    const checkpoint = await this.prisma.tenantPrisma.checkpoint.findFirst({
      where: { id: parts[1], status: 'active' },
      select: { id: true, siteId: true, qrVersion: true },
    });
    if (!checkpoint) return { valid: false, reason: 'not_found' };
    if (checkpoint.qrVersion !== Number(parts[2])) return { valid: false, reason: 'outdated' };
    return { valid: true, checkpoint };
  }
}
