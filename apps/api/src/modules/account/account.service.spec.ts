import {
  ACCOUNT_STATUSES,
  trialEndsAt,
  type AccountStatus,
  type SuspensionReason,
} from '@garita/shared';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AccountService } from './account.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

function setup(status: AccountStatus = 'trial') {
  const now = new Date('2030-11-01T15:00:00Z');
  const company = {
    id: 'company',
    accountStatus: status,
    suspensionReason: null as SuspensionReason | null,
    createdAt: now,
    timezone: 'America/Argentina/Buenos_Aires',
    trialEndsAt: trialEndsAt(now, 'America/Argentina/Buenos_Aires'),
    graceEndsAt: null as Date | null,
    suspendedAt: null as Date | null,
  };
  const users = [
    { role: 'guard', status: 'active' },
    { role: 'guard', status: 'invitation_pending' },
    { role: 'guard', status: 'deactivated' },
    { role: 'supervisor', status: 'active' },
  ];
  const db = {
    shift: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    shiftAssignment: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    company: {
      findUniqueOrThrow: jest.fn(() => Promise.resolve(company)),
      update: jest.fn(({ data }: { data: Partial<typeof company> }) =>
        Promise.resolve(Object.assign(company, data)),
      ),
    },
    plan: { findFirstOrThrow: jest.fn(() => Promise.resolve({ maxGuards: 3 })) },
    subscription: {
      findFirst: jest
        .fn<Promise<{ plan: { maxGuards: number } } | null>, []>()
        .mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    user: {
      count: jest.fn(({ where }: { where: { status: { in: string[] } } }) =>
        Promise.resolve(
          users.filter((u) => u.role === 'guard' && where.status.in.includes(u.status)).length,
        ),
      ),
    },
  };
  const prisma = {
    tenantPrisma: db,
    systemPrisma: {
      ...db,
      $transaction: async (run: (tx: typeof db) => Promise<unknown>) => run(db),
    },
  };
  const service = new AccountService(prisma as unknown as PrismaService, { now: () => now });
  return { service, company, db, users, now };
}

describe('AccountService HU-41', () => {
  it('get sin suscripción usa el básico y cuenta invitaciones pero no bajas ni supervisores', async () => {
    const f = setup();
    await expect(f.service.get('company')).resolves.toMatchObject({
      status: 'trial',
      guardLimit: 3,
    });
    await expect(f.service.response('company')).resolves.toMatchObject({
      trialDaysLeft: 14,
      guardsCounted: 2,
      amountDue: null,
    });
  });
  it('get con suscripción autorizada aplica el límite del plan', async () => {
    const f = setup('active');
    f.db.subscription.findFirst.mockResolvedValue({ plan: { maxGuards: 10 } });
    await expect(f.service.get('company')).resolves.toMatchObject({ guardLimit: 10 });
  });
  it('acepta debajo del límite y rechaza justo en el límite, contando pendientes', async () => {
    const f = setup();
    await expect(f.service.assertGuardSlot('company')).resolves.toBeUndefined();
    f.users.push({ role: 'guard', status: 'invitation_pending' });
    await expect(f.service.assertGuardSlot('company')).rejects.toMatchObject({
      response: {
        code: 'guard_limit_reached',
        guardLimit: 3,
        guardsCounted: 3,
        status: 'trial',
        message: 'Alcanzaste el límite de vigiladores de la prueba.',
      },
    });
  });
  it('rechaza cuenta suspendida aunque haya cupo', async () => {
    await expect(setup('suspended').service.assertGuardSlot('company')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('usa la transacción recibida y bloquea primero la empresa', async () => {
    const f = setup();
    await f.service.assertGuardSlot('company', f.db as unknown as Prisma.TransactionClient);
    expect(f.db.company.update.mock.invocationCallOrder[0]).toBeLessThan(
      f.db.company.findUniqueOrThrow.mock.invocationCallOrder[0] ?? Infinity,
    );
  });
  const valid = [
    ['trial', 'active', undefined],
    ['trial', 'suspended', 'trial_expired'],
    ['active', 'grace', undefined],
    ['active', 'suspended', 'cancelled'],
    ['grace', 'active', undefined],
    ['grace', 'suspended', 'grace_expired'],
    ['suspended', 'active', undefined],
  ] as const;
  it.each(valid)('transición válida %s → %s (%s)', async (from, to, reason) => {
    const f = setup(from);
    await f.service.transition({
      companyId: 'company',
      to,
      ...(reason ? { reason } : {}),
      ...(to === 'grace' ? { graceEndsAt: new Date('2030-11-08T02:59:00Z') } : {}),
    });
    expect(f.company.accountStatus).toBe(to);
    if (to === 'suspended') expect(f.company.suspensionReason).toBe(reason);
  });
  it.each(ACCOUNT_STATUSES)('transición a %s es idempotente', async (status) => {
    const f = setup(status);
    await f.service.transition({ companyId: 'company', to: status });
    expect(f.company.accountStatus).toBe(status);
    expect(f.db.company.update).toHaveBeenCalledTimes(1); // Solo el bloqueo.
  });
  const invalid = ACCOUNT_STATUSES.flatMap((from) =>
    ACCOUNT_STATUSES.filter(
      (to) => to !== from && !valid.some(([a, b]) => a === from && b === to),
    ).map((to) => [from, to] as const),
  );
  it.each(invalid)('rechaza transición inválida %s → %s', async (from, to) => {
    const f = setup(from);
    await expect(f.service.transition({ companyId: 'company', to })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(f.company.accountStatus).toBe(from);
  });
  it.each(['trial_expired', 'grace_expired', 'cancelled'] as const)(
    'exige motivo %s coherente con origen',
    async (reason) => {
      for (const from of ACCOUNT_STATUSES.filter((status) => status !== 'suspended')) {
        if (valid.some(([a, b, c]) => a === from && b === 'suspended' && c === reason)) continue;
        const f = setup(from);
        await expect(
          f.service.transition({ companyId: 'company', to: 'suspended', reason }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    },
  );
  it('exige fecha de gracia y motivo de suspensión', async () => {
    await expect(
      setup('active').service.transition({ companyId: 'company', to: 'grace' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup().service.transition({ companyId: 'company', to: 'suspended' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('activar limpia motivo, gracia y hora de suspensión', async () => {
    const f = setup('suspended');
    f.company.suspensionReason = 'trial_expired';
    f.company.suspendedAt = f.now;
    f.company.graceEndsAt = f.now;
    await f.service.transition({ companyId: 'company', to: 'active' });
    expect(f.company).toMatchObject({
      suspensionReason: null,
      graceEndsAt: null,
      suspendedAt: null,
    });
  });
  it('startTrial calcula una sola prueba desde creación y no permite reiniciarla', async () => {
    const f = setup();
    Object.assign(f.company, { trialEndsAt: null });
    await f.service.startTrial('company');
    expect(f.company.trialEndsAt).toEqual(new Date('2030-11-15T02:59:00Z'));
    await expect(f.service.startTrial('company')).rejects.toBeInstanceOf(ConflictException);
    f.company.accountStatus = 'suspended';
    Object.assign(f.company, { trialEndsAt: null });
    await expect(f.service.startTrial('company')).rejects.toBeInstanceOf(ConflictException);
  });
  it.each([0, 1])('fin de prueba con %s suscripciones autorizadas', async (authorized) => {
    const f = setup();
    f.db.subscription.count.mockResolvedValue(authorized);
    f.now.setTime(f.company.trialEndsAt.getTime() - 1);
    await f.service.finishTrial('company');
    expect(f.company.accountStatus).toBe('trial');
    f.now.setTime(f.now.getTime() + 1);
    await f.service.finishTrial('company');
    expect(f.company.accountStatus).toBe(authorized ? 'active' : 'suspended');
    await f.service.finishTrial('company');
    if (!authorized) expect(f.company.suspensionReason).toBe('trial_expired');
  });
});
