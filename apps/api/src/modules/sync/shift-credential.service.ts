import * as crypto from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { SHIFT_CREDENTIAL_VALID_DAYS_AFTER_END } from '@garita/shared';
import type { Env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK, type Clock } from '../../common/clock';

export const shiftCredentialPayloadSchema = z.object({
  shiftId: z.string().min(1),
  assignmentId: z.string().min(1),
  userId: z.string().min(1),
  companyId: z.string().min(1),
  exp: z.number().int().positive(),
});

export type ShiftCredentialPayload = z.infer<typeof shiftCredentialPayloadSchema>;

export type CredentialVerificationResult =
  | { valid: true; payload: ShiftCredentialPayload }
  | {
      valid: false;
      reason:
        | 'malformed'
        | 'invalid_signature'
        | 'expired'
        | 'revoked_or_not_found'
        | 'shift_or_assignment_not_found';
      payload?: ShiftCredentialPayload;
    };

@Injectable()
export class ShiftCredentialService {
  private readonly logger = new Logger(ShiftCredentialService.name);
  private readonly secret: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    const secret = config.get('SHIFT_CREDENTIAL_SECRET', { infer: true });
    if (!secret) {
      throw new Error('SHIFT_CREDENTIAL_SECRET no está configurada');
    }
    this.secret = secret;
  }

  signToken(payload: ShiftCredentialPayload): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  computeTokenHash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async issueCredential(params: {
    shiftId: string;
    assignmentId: string;
    userId: string;
    companyId: string;
    scheduledEnd: Date;
  }): Promise<{ token: string; expiresAt: string }> {
    const expiresAtMs =
      params.scheduledEnd.getTime() + SHIFT_CREDENTIAL_VALID_DAYS_AFTER_END * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(expiresAtMs);
    const exp = Math.floor(expiresAtMs / 1000);

    const payload: ShiftCredentialPayload = {
      shiftId: params.shiftId,
      assignmentId: params.assignmentId,
      userId: params.userId,
      companyId: params.companyId,
      exp,
    };

    const token = this.signToken(payload);
    const tokenHash = this.computeTokenHash(token);

    // systemPrisma se usa para persistir la credencial emitida sin depender de filtros tenant de usuario
    this.logger.log({
      event: 'shift_credential.issued',
      shiftId: params.shiftId,
      userId: params.userId,
      tokenHash,
      expiresAt: expiresAt.toISOString(),
    });

    await this.prisma.systemPrisma.shiftCredential.upsert({
      where: { tokenHash },
      create: {
        companyId: params.companyId,
        shiftId: params.shiftId,
        userId: params.userId,
        tokenHash,
        expiresAt,
      },
      update: {
        expiresAt,
        revokedAt: null,
      },
    });

    return { token, expiresAt: expiresAt.toISOString() };
  }

  isPotentialShiftCredential(token: string): boolean {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      return false;
    }

    try {
      const headerStr = Buffer.from(parts[0], 'base64url').toString('utf8');
      const bodyStr = Buffer.from(parts[1], 'base64url').toString('utf8');
      const body = JSON.parse(bodyStr) as Record<string, unknown>;

      if (body && typeof body === 'object' && typeof body.shiftId === 'string') {
        return true;
      }

      // Check header or signature
      const expected = crypto
        .createHmac('sha256', this.secret)
        .update(`${parts[0]}.${parts[1]}`)
        .digest();
      const supplied = Buffer.from(parts[2], 'base64url');
      if (supplied.length === expected.length && crypto.timingSafeEqual(expected, supplied)) {
        return true;
      }
      return headerStr.includes('HS256');
    } catch {
      return false;
    }
  }

  async verifyCredential(token: string): Promise<CredentialVerificationResult> {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      return { valid: false, reason: 'malformed' };
    }

    const expected = crypto
      .createHmac('sha256', this.secret)
      .update(`${parts[0]}.${parts[1]}`)
      .digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(parts[2], 'base64url');
    } catch {
      return { valid: false, reason: 'malformed' };
    }

    if (supplied.length !== expected.length || !crypto.timingSafeEqual(expected, supplied)) {
      return { valid: false, reason: 'invalid_signature' };
    }

    let payloadJson: unknown;
    try {
      payloadJson = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      return { valid: false, reason: 'malformed' };
    }

    const parsed = shiftCredentialPayloadSchema.safeParse(payloadJson);
    if (!parsed.success) {
      return { valid: false, reason: 'malformed' };
    }

    const payload = parsed.data;
    const now = this.clock.now();
    const nowSec = Math.floor(now.getTime() / 1000);

    if (payload.exp <= nowSec) {
      return { valid: false, reason: 'expired', payload };
    }

    const tokenHash = this.computeTokenHash(token);

    // systemPrisma se usa para auditar y verificar el estado de revocación de la credencial de turno
    this.logger.debug({ event: 'shift_credential.lookup', tokenHash });
    const credRecord = await this.prisma.systemPrisma.shiftCredential.findUnique({
      where: { tokenHash },
    });

    if (!credRecord || credRecord.revokedAt !== null || credRecord.expiresAt <= now) {
      return { valid: false, reason: 'revoked_or_not_found', payload };
    }

    // systemPrisma se usa para verificar existencia de turno y asignación sin validar User.status (CA10)
    this.logger.debug({ event: 'shift_credential.check_shift', shiftId: payload.shiftId });
    const shift = await this.prisma.systemPrisma.shift.findFirst({
      where: { id: payload.shiftId, companyId: payload.companyId },
      include: {
        assignments: {
          where: { id: payload.assignmentId, guardId: payload.userId },
        },
      },
    });

    if (!shift || shift.assignments.length === 0) {
      return { valid: false, reason: 'shift_or_assignment_not_found', payload };
    }

    return { valid: true, payload };
  }
}
