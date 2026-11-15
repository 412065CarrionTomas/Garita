import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import type { Env } from '../../config/env';
import type { PrismaService } from '../prisma/prisma.service';
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
  };
  const db = {
    plan: { findFirst: jest.fn().mockResolvedValue(plan) },
    company: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ trialEndsAt: options.trialEndsAt ?? null }),
    },
    subscription,
    subscriptionCharge: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const mercadoPago = {
    createPreapproval: jest
      .fn()
      .mockResolvedValue({ id: 'mp-new', status: 'pending', init_point: 'https://mp/checkout' }),
    cancelPreapproval: jest.fn().mockResolvedValue({ id: 'mp-old', status: 'cancelled' }),
    getPreapproval: jest.fn(),
    searchAuthorizedPayments: jest.fn().mockResolvedValue([]),
  };
  const config = { get: jest.fn().mockReturnValue('http://localhost:5173') };
  const service = new SubscriptionsService(
    { tenantPrisma: db, systemPrisma: db } as unknown as PrismaService,
    mercadoPago as unknown as MercadoPagoClient,
    config as unknown as ConfigService<Env, true>,
    { now: () => NOW },
  );
  return { service, db, mercadoPago };
}

const request = { planId: 'plan-10', payerEmail: 'buyer@testuser.com', keepTrial: false };

describe('SubscriptionsService.create', () => {
  it('rejects a second subscription when one is already authorized', async () => {
    const { service, mercadoPago } = setup({ open: { id: 'sub-1', status: 'authorized' } });
    await expect(service.create('company-1', request)).rejects.toBeInstanceOf(ConflictException);
    expect(mercadoPago.createPreapproval).not.toHaveBeenCalled();
  });

  it('replaces an abandoned pending checkout and charges right away without a trial', async () => {
    const { service, db, mercadoPago } = setup({
      open: { id: 'sub-old', status: 'pending', mpPreapprovalId: 'mp-old' },
    });
    await expect(service.create('company-1', request)).resolves.toEqual({
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
    await kept.service.create('company-1', { ...request, keepTrial: true });
    expect(kept.mercadoPago.createPreapproval).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: trialEndsAt }),
    );

    const skipped = setup({ trialEndsAt });
    await skipped.service.create('company-1', request);
    expect(skipped.mercadoPago.createPreapproval).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: undefined }),
    );
  });

  it('cancels the local row when Mercado Pago fails, so the admin can retry', async () => {
    const { service, db, mercadoPago } = setup();
    mercadoPago.createPreapproval.mockRejectedValue(new Error('boom'));
    await expect(service.create('company-1', request)).rejects.toThrow('boom');
    expect(db.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-new' },
      data: { status: 'cancelled', lastFailureReason: 'No se pudo crear en Mercado Pago' },
    });
  });
});

describe('SubscriptionsService.syncPreapproval', () => {
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
