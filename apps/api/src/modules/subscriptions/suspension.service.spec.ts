import { Logger } from '@nestjs/common';
import { SuspensionService } from './suspension.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MercadoPagoClient } from './mercadopago.client';
import type { GraceService } from './grace.service';
import type { GuardSelectionService } from './guard-selection';

function fixture(suspended = true) {
  const company = {
    id: 'company',
    accountStatus: suspended ? 'suspended' : 'active',
    suspensionReason: suspended ? 'grace_expired' : null,
    suspensionEffectsPending: true,
    suspendedAt: new Date('2030-12-08T23:59:00Z'),
  };
  const subscription = {
    id: 'sub',
    companyId: 'company',
    mpPreapprovalId: 'mp',
    status: suspended ? 'authorized' : 'paused',
    suspensionPausedAt: suspended ? null : new Date('2030-12-08T23:59:00Z'),
    suspensionPlanId: null,
    nextChargeAt: new Date('2031-01-01T12:00:00Z'),
    guardSelection: null,
  };
  const db = {
    company: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(company),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve(Object.assign(company, data)),
        ),
    },
    subscription: {
      findFirst: jest.fn().mockResolvedValue(subscription),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve(Object.assign(subscription, data)),
        ),
    },
    shift: { updateMany: jest.fn() },
    shiftAssignment: { updateMany: jest.fn() },
  };
  const remote = {
    id: 'mp',
    status: suspended ? 'authorized' : 'paused',
    next_payment_date: '2031-01-01T12:00:00Z',
  };
  const mp = {
    getPreapproval: jest.fn().mockImplementation(() => Promise.resolve({ ...remote })),
    setPreapprovalStatus: jest.fn().mockImplementation((_id: string, status: string) => {
      remote.status = status;
      return Promise.resolve({ ...remote });
    }),
  };
  const selection = { apply: jest.fn().mockResolvedValue(null) };
  const service = new SuspensionService(
    {
      systemPrisma: {
        ...db,
        $transaction: async (run: (tx: typeof db) => Promise<unknown>) => run(db),
      },
    } as unknown as PrismaService,
    mp as unknown as MercadoPagoClient,
    {} as GraceService,
    selection as unknown as GuardSelectionService,
    { now: () => new Date('2030-12-20T12:00:00Z') },
  );
  return { service, company, subscription, db, mp, remote, selection };
}

describe('HU-43 suspension effects', () => {
  it('pauses once and cancels only unstarted due shifts', async () => {
    const f = fixture();
    await f.service.reconcile('company');
    await f.service.reconcile('company');
    expect(f.mp.setPreapprovalStatus).toHaveBeenCalledTimes(1);
    expect(f.mp.setPreapprovalStatus).toHaveBeenCalledWith('mp', 'paused');
    expect(f.db.shift.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'company',
          startsAt: { lte: new Date('2030-12-20T12:00:00Z') },
          endsAt: { gt: new Date('2030-12-08T23:59:00Z') },
          startedAt: null,
          status: { in: ['scheduled', 'unassigned'] },
        },
      }),
    );
  });
  it('does not touch a cancellation already paused by HU-42', async () => {
    const f = fixture();
    f.company.suspensionReason = 'cancelled';
    await f.service.reconcile('company');
    expect(f.mp.setPreapprovalStatus).not.toHaveBeenCalled();
  });
  it('resumes and leaves our expected charge date untouched', async () => {
    const f = fixture(false);
    const expected = f.subscription.nextChargeAt;
    await f.service.reconcile('company');
    await f.service.reconcile('company');
    expect(f.mp.setPreapprovalStatus).toHaveBeenCalledTimes(1);
    expect(f.mp.setPreapprovalStatus).toHaveBeenCalledWith('mp', 'authorized');
    expect(f.subscription.nextChargeAt).toEqual(expected);
    expect(f.subscription.status).toBe('authorized');
  });
  it('logs both dates on mismatch without correcting Mercado Pago or disabling the account', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const f = fixture(false);
      f.remote.next_payment_date = '2031-01-20T12:00:00Z';
      await f.service.reconcile('company');
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'subscription.next_payment_date_diff',
          expected: '2031-01-01T12:00:00.000Z',
          actual: '2031-01-20T12:00:00Z',
        }),
      );
      expect(f.company.accountStatus).toBe('active');
      // V9 H1: después de comparar, la fecha visible es la que informa Mercado Pago.
      expect(f.subscription.nextChargeAt.toISOString()).toBe('2031-01-20T12:00:00.000Z');
    } finally {
      log.mockRestore();
    }
  });
  it('keeps the durable marker on failure and retries the pause', async () => {
    const f = fixture();
    f.mp.setPreapprovalStatus.mockRejectedValueOnce(new Error('timeout'));
    await expect(f.service.reconcile('company')).rejects.toThrow('timeout');
    expect(f.company.suspensionEffectsPending).toBe(true);
    await f.service.reconcile('company');
    expect(f.subscription.status).toBe('paused');
  });
});
