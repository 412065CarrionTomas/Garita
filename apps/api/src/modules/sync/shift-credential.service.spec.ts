import { ConfigService } from '@nestjs/config';
import { ShiftCredentialService } from './shift-credential.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { Clock } from '../../common/clock';

describe('ShiftCredentialService', () => {
  const secret = 'test-shift-credential-secret-minimum-32-chars-long';
  const fixedNow = new Date('2026-10-14T10:00:00.000Z');
  let clock: Clock;
  let config: ConfigService;
  let prisma: PrismaService;
  let service: ShiftCredentialService;
  let storedCredentials: Map<
    string,
    { tokenHash: string; expiresAt: Date; revokedAt: Date | null }
  >;
  let shifts: Map<
    string,
    { id: string; companyId: string; assignments: { id: string; guardId: string }[] }
  >;

  beforeEach(() => {
    storedCredentials = new Map();
    shifts = new Map();

    clock = { now: () => fixedNow };
    config = {
      get: (key: string) => (key === 'SHIFT_CREDENTIAL_SECRET' ? secret : undefined),
    } as unknown as ConfigService;

    prisma = {
      systemPrisma: {
        shiftCredential: {
          upsert: jest.fn(async ({ where, create, update }) => {
            const existing = storedCredentials.get(where.tokenHash);
            if (existing) {
              existing.expiresAt = update.expiresAt ?? existing.expiresAt;
              existing.revokedAt =
                update.revokedAt !== undefined ? update.revokedAt : existing.revokedAt;
              return existing;
            }
            const record = { ...create, revokedAt: null };
            storedCredentials.set(where.tokenHash, record);
            return record;
          }),
          findUnique: jest.fn(async ({ where }) => {
            return storedCredentials.get(where.tokenHash) ?? null;
          }),
        },
        shift: {
          findFirst: jest.fn(async ({ where }) => {
            const shift = shifts.get(where.id);
            if (!shift || shift.companyId !== where.companyId) return null;
            const assignmentFilter = where.assignments?.where;
            if (assignmentFilter) {
              const matchingAssignments = shift.assignments.filter(
                (a) => a.id === assignmentFilter.id && a.guardId === assignmentFilter.guardId,
              );
              return { ...shift, assignments: matchingAssignments };
            }
            return shift;
          }),
        },
      },
    } as unknown as PrismaService;

    service = new ShiftCredentialService(config as never, prisma, clock);
  });

  it('emite una credencial firmada con expiración a 7 días después del fin programado', async () => {
    const scheduledEnd = new Date('2026-10-14T18:00:00.000Z');
    const result = await service.issueCredential({
      shiftId: 'shift-1',
      assignmentId: 'assign-1',
      userId: 'guard-1',
      companyId: 'company-1',
      scheduledEnd,
    });

    expect(result.token).toBeDefined();
    expect(result.expiresAt).toBe('2026-10-21T18:00:00.000Z');

    const tokenHash = service.computeTokenHash(result.token);
    expect(storedCredentials.has(tokenHash)).toBe(true);
  });

  it('verifica exitosamente una credencial válida', async () => {
    const scheduledEnd = new Date('2026-10-14T18:00:00.000Z');
    shifts.set('shift-1', {
      id: 'shift-1',
      companyId: 'company-1',
      assignments: [{ id: 'assign-1', guardId: 'guard-1' }],
    });

    const issued = await service.issueCredential({
      shiftId: 'shift-1',
      assignmentId: 'assign-1',
      userId: 'guard-1',
      companyId: 'company-1',
      scheduledEnd,
    });

    const verified = await service.verifyCredential(issued.token);
    expect(verified.valid).toBe(true);
    if (verified.valid) {
      expect(verified.payload.shiftId).toBe('shift-1');
      expect(verified.payload.assignmentId).toBe('assign-1');
      expect(verified.payload.userId).toBe('guard-1');
      expect(verified.payload.companyId).toBe('company-1');
    }
  });

  it('rechaza una credencial con formato o firma manipulada', async () => {
    const scheduledEnd = new Date('2026-10-14T18:00:00.000Z');
    shifts.set('shift-1', {
      id: 'shift-1',
      companyId: 'company-1',
      assignments: [{ id: 'assign-1', guardId: 'guard-1' }],
    });

    const issued = await service.issueCredential({
      shiftId: 'shift-1',
      assignmentId: 'assign-1',
      userId: 'guard-1',
      companyId: 'company-1',
      scheduledEnd,
    });

    expect(await service.verifyCredential('invalid.token')).toEqual({
      valid: false,
      reason: 'malformed',
    });

    const parts = issued.token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ shiftId: 'shift-2', exp: Math.floor(Date.now() / 1000) + 1000 }),
    ).toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    expect(await service.verifyCredential(tamperedToken)).toEqual({
      valid: false,
      reason: 'invalid_signature',
    });
  });

  it('rechaza una credencial vencida', async () => {
    const pastEnd = new Date('2026-10-01T10:00:00.000Z'); // 7 days after = 2026-10-08, before fixedNow (2026-10-14)
    shifts.set('shift-1', {
      id: 'shift-1',
      companyId: 'company-1',
      assignments: [{ id: 'assign-1', guardId: 'guard-1' }],
    });

    const issued = await service.issueCredential({
      shiftId: 'shift-1',
      assignmentId: 'assign-1',
      userId: 'guard-1',
      companyId: 'company-1',
      scheduledEnd: pastEnd,
    });

    const verified = await service.verifyCredential(issued.token);
    expect(verified.valid).toBe(false);
    if (!verified.valid) {
      expect(verified.reason).toBe('expired');
    }
  });

  it('rechaza una credencial revocada en la base de datos', async () => {
    const scheduledEnd = new Date('2026-10-14T18:00:00.000Z');
    shifts.set('shift-1', {
      id: 'shift-1',
      companyId: 'company-1',
      assignments: [{ id: 'assign-1', guardId: 'guard-1' }],
    });

    const issued = await service.issueCredential({
      shiftId: 'shift-1',
      assignmentId: 'assign-1',
      userId: 'guard-1',
      companyId: 'company-1',
      scheduledEnd,
    });

    const tokenHash = service.computeTokenHash(issued.token);
    const stored = storedCredentials.get(tokenHash);
    if (stored) {
      stored.revokedAt = new Date();
    }

    const verified = await service.verifyCredential(issued.token);
    expect(verified.valid).toBe(false);
    if (!verified.valid) {
      expect(verified.reason).toBe('revoked_or_not_found');
    }
  });

  it('rechaza si el turno o la asignación no existen', async () => {
    const scheduledEnd = new Date('2026-10-14T18:00:00.000Z');
    // Don't add to shifts map
    const issued = await service.issueCredential({
      shiftId: 'shift-unknown',
      assignmentId: 'assign-1',
      userId: 'guard-1',
      companyId: 'company-1',
      scheduledEnd,
    });

    const verified = await service.verifyCredential(issued.token);
    expect(verified.valid).toBe(false);
    if (!verified.valid) {
      expect(verified.reason).toBe('shift_or_assignment_not_found');
    }
  });

  it('detecta potencialmente una credencial de turno para AuthGuard', async () => {
    const scheduledEnd = new Date('2026-10-14T18:00:00.000Z');
    const issued = await service.issueCredential({
      shiftId: 'shift-1',
      assignmentId: 'assign-1',
      userId: 'guard-1',
      companyId: 'company-1',
      scheduledEnd,
    });

    expect(service.isPotentialShiftCredential(issued.token)).toBe(true);
    expect(service.isPotentialShiftCredential('random-firebase-id-token')).toBe(false);
  });
});
