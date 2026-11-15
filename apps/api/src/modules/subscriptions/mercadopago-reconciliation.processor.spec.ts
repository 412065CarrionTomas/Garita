import type { Job, Queue } from 'bullmq';
import type { PrismaService } from '../prisma/prisma.service';
import type { SubscriptionsService } from './subscriptions.service';
import type { GuardSelectionService } from './guard-selection';
import type { MercadoPagoWebhookService } from './mercadopago-webhook.service';
import { MercadoPagoReconciliationProcessor } from './mercadopago-reconciliation.processor';

describe('MercadoPagoReconciliationProcessor', () => {
  function setup() {
    const row = {
      id: 'sub',
      status: 'authorized',
      companyId: 'company',
      mpPreapprovalId: 'mp',
      guardSelection: null,
    };
    const db = {
      subscription: {
        findMany: jest.fn().mockResolvedValue([row]),
        findUniqueOrThrow: jest.fn().mockResolvedValue(row),
      },
      mercadoPagoNotification: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const queue = { add: jest.fn(), upsertJobScheduler: jest.fn() };
    const subscriptions = { syncPreapproval: jest.fn(), finishDueCancellation: jest.fn() };
    const selection = { apply: jest.fn() };
    const processor = new MercadoPagoReconciliationProcessor(
      { systemPrisma: db } as unknown as PrismaService,
      subscriptions as unknown as SubscriptionsService,
      selection as unknown as GuardSelectionService,
      {} as MercadoPagoWebhookService,
      queue as unknown as Queue,
    );
    return { processor, subscriptions, row, queue };
  }
  it('schedules 03:00 Buenos Aires and the five minute pending sweep with fixed identities', async () => {
    const { processor, queue } = setup();
    await processor.onModuleInit();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'mercadopago-daily',
      { pattern: '0 3 * * *', tz: 'America/Argentina/Buenos_Aires' },
      expect.anything(),
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'mercadopago-pending-guards',
      { every: 300_000 },
      expect.anything(),
    );
  });
  it('enqueues independent retryable jobs so a remote failure cannot block remaining subscriptions', async () => {
    const { processor, queue } = setup();
    await processor.process({ id: 'daily', data: { kind: 'daily' } } as Job);
    expect(queue.add).toHaveBeenCalledWith(
      'subscription',
      { kind: 'subscription', id: 'sub' },
      expect.objectContaining({ attempts: 6, backoff: { type: 'custom' } }),
    );
  });
  it('uses exactly the webhook synchronizer with difference logging enabled', async () => {
    const { processor, subscriptions } = setup();
    await processor.process({ id: 'daily-sub', data: { kind: 'subscription', id: 'sub' } } as Job);
    expect(subscriptions.syncPreapproval).toHaveBeenCalledWith('mp', 'daily-sub', undefined, true);
    expect(subscriptions.finishDueCancellation).toHaveBeenCalled();
  });
});
