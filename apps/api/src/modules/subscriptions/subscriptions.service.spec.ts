import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import type { Env } from '../../config/env';
import type { PrismaService } from '../prisma/prisma.service';
import type { AccountStatePort } from '../../common/ports/account-state.port';

import type { GuardSelectionService } from './guard-selection';
import type { MercadoPagoClient } from './mercadopago.client';
import { SubscriptionsService } from './subscriptions.service';

const NOW = new Date('2026-11-15T12:00:00.000Z');
const plan = {
  id: 'plan-10',
  name: 'Hasta 10 vigiladores',
  monthlyPrice: new Prisma.Decimal('45000.00'),
  maxGuards: 10,
  active: true,
};

function setup(options: { open?: object | null; trialEndsAt?: Date | null; local?: object } = {}) {
  const subscription = {
    findFirst: jest.fn().mockResolvedValue(options.open ?? null),
    findUnique: jest.fn().mockResolvedValue(options.local ?? null),
    create: jest.fn().mockResolvedValue({ id: 'sub-new' }),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUniqueOrThrow: jest.fn(),
  };
  const db = {
    plan: { findFirst: jest.fn().mockResolvedValue(plan) },
    company: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ trialEndsAt: options.trialEndsAt ?? null }),
    },
    subscription,
    subscriptionCharge: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      upsert: jest
        .fn()
        .mockImplementation(({ create }: { create: object }) =>
          Promise.resolve({ id: 'charge', ...create }),
        ),
    },
    $executeRaw: jest.fn(),
  };
  const mercadoPago = {
    createPreapproval: jest
      .fn()
      .mockResolvedValue({ id: 'mp-new', status: 'pending', init_point: 'https://mp/checkout' }),
    cancelPreapproval: jest.fn().mockResolvedValue({ id: 'mp-old', status: 'cancelled' }),
    getPreapproval: jest.fn(),
    setPreapprovalStatus: jest.fn().mockResolvedValue({ id: 'mp-1', status: 'paused' }),
    searchAuthorizedPayments: jest.fn().mockResolvedValue([]),
  };
  const config = { get: jest.fn().mockReturnValue('http://localhost:5173') };
  const systemPrisma = {
    ...db,
    $transaction: (run: (tx: typeof db) => Promise<unknown>) => run(db),
  };
  const account = { get: jest.fn().mockResolvedValue({ status: 'active' }), transition: jest.fn() };
  const selection = { validate: jest.fn().mockResolvedValue(null), apply: jest.fn() };
  const effects = {
    onChargeRejected: jest.fn(),
    onChargeApproved: jest.fn(),
    onOneTimePayment: jest.fn(),
  };
  const service = new SubscriptionsService(
    { tenantPrisma: db, systemPrisma } as unknown as PrismaService,
    mercadoPago as unknown as MercadoPagoClient,
    config as unknown as ConfigService<Env, true>,
    { now: () => NOW },
    account as unknown as AccountStatePort,
    effects,
    selection as unknown as GuardSelectionService,
  );
  return { service, db, mercadoPago, account, effects };
}

const request = { planId: 'plan-10', payerEmail: 'buyer@testuser.com', keepTrial: false };

describe('SubscriptionsService.create', () => {
  it('rejects a second subscription when one is already authorized', async () => {
    const { service, mercadoPago } = setup({ open: { id: 'sub-1', status: 'authorized' } });
    await expect(service.create('company-1', request, 'admin')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mercadoPago.createPreapproval).not.toHaveBeenCalled();
  });

  it('replaces an abandoned pending checkout and charges right away without a trial', async () => {
    const { service, db, mercadoPago } = setup({
      open: { id: 'sub-old', status: 'pending', mpPreapprovalId: 'mp-old' },
    });
    await expect(service.create('company-1', request, 'admin')).resolves.toEqual({
      initPoint: 'https://mp/checkout',
    });
    expect(mercadoPago.cancelPreapproval).toHaveBeenCalledWith('mp-old');
    expect(db.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-old' },
      data: { status: 'cancelled' },
    });
    expect(mercadoPago.createPreapproval).toHaveBeenCalledWith(
      expect.objectContaining({
        externalReference: 'sub-new',
        amount: 45000,
        startDate: undefined,
        backUrl: 'http://localhost:5173/suscripcion',
      }),
    );
  });

  it('defers the first charge to the end of the trial only when the admin keeps it', async () => {
    const trialEndsAt = new Date('2026-11-25T02:59:59.000Z');
    const kept = setup({ trialEndsAt });
    await kept.service.create('company-1', { ...request, keepTrial: true }, 'admin');
    expect(kept.mercadoPago.createPreapproval).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: trialEndsAt }),
    );

    const skipped = setup({ trialEndsAt });
    await skipped.service.create('company-1', request, 'admin');
    expect(skipped.mercadoPago.createPreapproval).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: undefined }),
    );
  });

  it('cancels the local row when Mercado Pago fails, so the admin can retry', async () => {
    const { service, db, mercadoPago } = setup();
    mercadoPago.createPreapproval.mockRejectedValue(new Error('boom'));
    await expect(service.create('company-1', request, 'admin')).rejects.toThrow('boom');
    expect(db.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-new' },
      data: { status: 'cancelled', lastFailureReason: 'No se pudo crear en Mercado Pago' },
    });
  });
});

describe('SubscriptionsService.syncPreapproval', () => {
  it.each([false, true])(
    'authorizes with deferred trial=%s without ending a retained trial',
    async (deferred) => {
      const { service, mercadoPago, account } = setup({
        local: {
          id: 'sub-1',
          companyId: 'company-1',
          status: 'pending',
          startsAt: new Date(deferred ? '2026-11-25T12:00:00Z' : '2026-11-15T12:00:00Z'),
        },
      });
      account.get.mockResolvedValue({ status: 'trial' });
      mercadoPago.getPreapproval.mockResolvedValue({ id: 'mp-1', status: 'authorized' });
      await service.syncPreapproval('mp-1');
      expect(account.transition).toHaveBeenCalledTimes(deferred ? 0 : 1);
    },
  );
  it('copies the remote status and charges, keeping the rejection reason', async () => {
    const { service, db, mercadoPago } = setup({
      local: { id: 'sub-1', companyId: 'company-1', status: 'pending' },
    });
    mercadoPago.getPreapproval.mockResolvedValue({
      id: 'mp-1',
      status: 'pending',
      next_payment_date: null,
    });
    mercadoPago.searchAuthorizedPayments.mockResolvedValue([
      {
        id: '77',
        preapproval_id: 'mp-1',
        transaction_amount: 45000,
        date_created: '2026-11-15T12:00:00.000Z',
        payment: { id: '88', status: 'rejected', status_detail: 'cc_rejected_insufficient_amount' },
      },
    ]);
    await service.syncPreapproval('mp-1');
    expect(db.subscriptionCharge.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { mpAuthorizedPaymentId: '77' },
        update: {
          mpPaymentId: '88',
          amount: new Prisma.Decimal('45000.00'),
          status: 'rejected',
          statusDetail: 'cc_rejected_insufficient_amount',
          retryAttempt: 0,
          chargedAt: new Date('2026-11-15T12:00:00.000Z'),
        },
      }),
    );
    expect(db.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: {
        status: 'pending',
        nextChargeAt: null,
        lastFailureReason: 'cc_rejected_insufficient_amount',
      },
    });
  });

  it('takes the failure reason from the latest settled charge, whatever the order of the search', async () => {
    const { service, db, mercadoPago } = setup({
      local: { id: 'sub-1', companyId: 'company-1', status: 'paused' },
    });
    mercadoPago.getPreapproval.mockResolvedValue({ id: 'mp-1', status: 'paused' });
    const charge = (id: string, date: string, status: string, detail: string) => ({
      id,
      preapproval_id: 'mp-1',
      transaction_amount: 45000,
      date_created: date,
      payment: { id: `p${id}`, status, status_detail: detail },
    });
    mercadoPago.searchAuthorizedPayments.mockResolvedValue([
      charge('1', '2026-09-15T12:00:00.000Z', 'rejected', 'cc_rejected_other_reason'),
      charge('3', '2026-11-15T12:00:00.000Z', 'rejected', 'cc_rejected_insufficient_amount'),
      charge('2', '2026-10-15T12:00:00.000Z', 'approved', 'accredited'),
    ]);
    await service.syncPreapproval('mp-1');
    expect(db.subscription.update).toHaveBeenLastCalledWith({
      where: { id: 'sub-1' },
      data: {
        status: 'paused',
        nextChargeAt: null,
        lastFailureReason: 'cc_rejected_insufficient_amount',
      },
    });

    mercadoPago.searchAuthorizedPayments.mockResolvedValue([
      charge('1', '2026-09-15T12:00:00.000Z', 'rejected', 'cc_rejected_other_reason'),
      charge('2', '2026-10-15T12:00:00.000Z', 'approved', 'accredited'),
    ]);
    await service.syncPreapproval('mp-1');
    expect(db.subscription.update).toHaveBeenLastCalledWith({
      where: { id: 'sub-1' },
      data: { status: 'paused', nextChargeAt: null, lastFailureReason: null },
    });
  });

  it('links by external reference a webhook that arrives before the preapproval id is stored', async () => {
    const { service, db, mercadoPago } = setup();
    db.subscription.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'sub-1', companyId: 'company-1', status: 'pending' });
    mercadoPago.getPreapproval.mockResolvedValue({
      id: 'mp-1',
      status: 'pending',
      external_reference: 'sub-1',
    });
    await service.syncPreapproval('mp-1');
    expect(db.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-1', mpPreapprovalId: null },
      data: { mpPreapprovalId: 'mp-1' },
    });
    expect(db.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sub-1' } }),
    );
  });

  it('cancels in Mercado Pago a replaced checkout that was completed later', async () => {
    const { service, db, mercadoPago } = setup({
      local: { id: 'sub-old', companyId: 'company-1', status: 'cancelled' },
    });
    mercadoPago.getPreapproval.mockResolvedValue({ id: 'mp-old', status: 'authorized' });
    await service.syncPreapproval('mp-old');
    expect(mercadoPago.cancelPreapproval).toHaveBeenCalledWith('mp-old');
    expect(db.subscription.update).not.toHaveBeenCalled();
  });
});

describe('SubscriptionsService cancellation', () => {
  const paidUntil = new Date('2026-12-15T12:00:00.000Z');

  it('pauses the debit and keeps the service until the end of the paid cycle', async () => {
    const { service, db, mercadoPago } = setup({
      open: { id: 'sub-1', status: 'authorized', mpPreapprovalId: 'mp-1', cancelAt: null },
    });
    jest.spyOn(service, 'syncPreapproval').mockResolvedValue();
    const get = jest
      .spyOn(service, 'get')
      .mockResolvedValue({ trialEndsAt: null, subscription: null });
    db.subscription.findUniqueOrThrow.mockResolvedValue({ nextChargeAt: paidUntil });

    await service.cancel('company-1', 'user-1', 'Cerramos la empresa');

    expect(mercadoPago.setPreapprovalStatus).toHaveBeenCalledWith('mp-1', 'paused');
    expect(mercadoPago.cancelPreapproval).not.toHaveBeenCalled();
    expect(db.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: {
        status: 'paused',
        cancelAt: paidUntil,
        cancelReason: 'Cerramos la empresa',
        cancelRequestedAt: NOW,
        cancelRequestedById: 'user-1',
      },
    });
    expect(get).toHaveBeenCalledWith('company-1');
  });

  it('does not cancel twice', async () => {
    const { service, mercadoPago } = setup({
      open: { id: 'sub-1', status: 'paused', mpPreapprovalId: 'mp-1', cancelAt: paidUntil },
    });
    await expect(service.cancel('company-1', 'user-1', undefined)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mercadoPago.setPreapprovalStatus).not.toHaveBeenCalled();
  });

  it('reverts a scheduled cancellation before the cycle ends', async () => {
    const { service, db, mercadoPago } = setup({
      open: { id: 'sub-1', status: 'paused', mpPreapprovalId: 'mp-1', cancelAt: paidUntil },
    });
    jest.spyOn(service, 'get').mockResolvedValue({ trialEndsAt: null, subscription: null });

    await service.revertCancellation('company-1');

    expect(mercadoPago.setPreapprovalStatus).toHaveBeenCalledWith('mp-1', 'authorized');
    expect(db.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: {
        status: 'authorized',
        cancelAt: null,
        cancelReason: null,
        cancelRequestedAt: null,
        cancelRequestedById: null,
      },
    });
  });

  it('refuses to revert once the paid cycle is over', async () => {
    const { service, mercadoPago } = setup({
      open: {
        id: 'sub-1',
        status: 'paused',
        mpPreapprovalId: 'mp-1',
        cancelAt: new Date('2026-11-01T00:00:00.000Z'),
      },
    });
    await expect(service.revertCancellation('company-1')).rejects.toBeInstanceOf(ConflictException);
    expect(mercadoPago.setPreapprovalStatus).not.toHaveBeenCalled();
  });

  it('refuses to revert when nothing was cancelled', async () => {
    const { service } = setup();
    await expect(service.revertCancellation('company-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ends the subscription in Mercado Pago once the paid cycle is over', async () => {
    const { service, db, mercadoPago } = setup({
      open: {
        id: 'sub-1',
        status: 'paused',
        mpPreapprovalId: 'mp-1',
        cancelAt: new Date('2026-11-15T11:59:00.000Z'),
      },
    });
    const sync = jest.spyOn(service, 'syncPreapproval');
    db.subscription.findUniqueOrThrow.mockResolvedValue({
      id: 'sub-1',
      status: 'cancelled',
      plan,
      _count: { charges: 0 },
      payerEmail: 'buyer@testuser.com',
      startsAt: NOW,
      nextChargeAt: null,
      lastFailureReason: null,
      cancelAt: new Date('2026-11-15T11:59:00.000Z'),
      charges: [],
    });

    const result = await service.get('company-1');

    expect(mercadoPago.cancelPreapproval).toHaveBeenCalledWith('mp-1');
    expect(db.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { status: 'cancelled' },
    });
    expect(sync).not.toHaveBeenCalled();
    expect(result.subscription?.status).toBe('cancelled');
  });
});

describe('entrega de efectos después del commit', () => {
  it('entrega cronológicamente y marca solo el estado entregado', async () => {
    const f = setup({ local: { id: 'sub-1', companyId: 'company-1', status: 'authorized' } });
    f.mercadoPago.getPreapproval.mockResolvedValue({ id: 'mp-1', status: 'authorized' });
    f.db.subscriptionCharge.findMany.mockResolvedValue([
      { id: 'rejected', status: 'rejected', effectsAppliedStatus: null },
      { id: 'approved', status: 'approved', effectsAppliedStatus: null },
      { id: 'done', status: 'approved', effectsAppliedStatus: 'approved' },
    ]);
    await f.service.syncPreapproval('mp-1');
    expect(f.effects.onChargeRejected).toHaveBeenCalledTimes(1);
    expect(f.effects.onChargeApproved).toHaveBeenCalledTimes(1);
    expect(f.db.subscriptionCharge.updateMany).toHaveBeenCalledWith({
      where: { id: 'rejected', status: 'rejected' },
      data: { effectsAppliedStatus: 'rejected' },
    });
    expect(f.db.subscriptionCharge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ chargedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(f.db.subscription.findUnique.mock.invocationCallOrder.at(-1)).toBeLessThan(
      f.effects.onChargeRejected.mock.invocationCallOrder[0] ?? Infinity,
    );
  });
  it('propaga el fallo y deja el efecto sin marcar para reintentar', async () => {
    const f = setup({ local: { id: 'sub-1', companyId: 'company-1', status: 'authorized' } });
    f.mercadoPago.getPreapproval.mockResolvedValue({ id: 'mp-1', status: 'authorized' });
    f.db.subscriptionCharge.findMany.mockResolvedValue([
      { id: 'charge', status: 'rejected', effectsAppliedStatus: null },
    ]);
    f.effects.onChargeRejected.mockRejectedValueOnce(new Error('correo'));
    await expect(f.service.syncPreapproval('mp-1')).rejects.toThrow('correo');
    expect(f.db.subscriptionCharge.updateMany).not.toHaveBeenCalled();
    await f.service.syncPreapproval('mp-1');
    expect(f.effects.onChargeRejected).toHaveBeenCalledTimes(2);
    expect(f.db.subscriptionCharge.updateMany).toHaveBeenCalledTimes(1);
  });
});
