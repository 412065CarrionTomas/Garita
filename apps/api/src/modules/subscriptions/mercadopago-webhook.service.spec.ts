import type { Queue } from 'bullmq';
import type { PrismaService } from '../prisma/prisma.service';
import type { MercadoPagoClient } from './mercadopago.client';
import type { SubscriptionsService } from './subscriptions.service';
import { MercadoPagoWebhookService } from './mercadopago-webhook.service';
import { NoopSubscriptionEffects } from './subscription-effects.port';
import type { GraceService } from './grace.service';
import type { SubscriptionCharge } from '../../generated/prisma/client';

describe('MercadoPagoWebhookService', () => {
  function setup() {
    const row = {
      id: '123',
      type: 'subscription_preapproval',
      action: null,
      resourceId: 'mp',
      status: 'received',
    };
    const db = {
      mercadoPagoNotification: {
        upsert: jest.fn().mockResolvedValue(row),
        findUniqueOrThrow: jest.fn().mockImplementation(() => Promise.resolve({ ...row })),
        update: jest.fn().mockImplementation(({ data }: { data: object }) => {
          Object.assign(row, data);
          return Promise.resolve(row);
        }),
      },
    };
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const subscriptions = { syncPreapproval: jest.fn().mockResolvedValue(undefined) };
    const client = {
      getAuthorizedPayment: jest.fn().mockResolvedValue({ id: 'payment', preapproval_id: 'mp' }),
      getPayment: jest.fn().mockResolvedValue({ id: 'payment', status: 'approved' }),
    };
    const effects = new NoopSubscriptionEffects({
      approved: jest.fn().mockResolvedValue(undefined),
      rejected: jest.fn().mockResolvedValue(undefined),
      oneTimePayment: jest.fn().mockResolvedValue(undefined),
    } as unknown as GraceService);
    const service = new MercadoPagoWebhookService(
      client as unknown as MercadoPagoClient,
      subscriptions as unknown as SubscriptionsService,
      { systemPrisma: db } as unknown as PrismaService,
      queue as unknown as Queue,
      effects,
    );
    return { service, row, db, queue, subscriptions, client, effects };
  }
  it('persists before queueing and processes a duplicate only once', async () => {
    const { service, row, queue, subscriptions } = setup();
    await service.receive(row);
    expect(queue.add).toHaveBeenCalledWith(
      'process',
      { notificationId: '123' },
      expect.objectContaining({ jobId: '123', attempts: 6 }),
    );
    await service.process('123');
    await service.receive(row);
    await service.process('123');
    expect(subscriptions.syncPreapproval).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('processed');
  });
  it('records failures and retries rather than swallowing them', async () => {
    const { service, subscriptions, row } = setup();
    subscriptions.syncPreapproval.mockRejectedValueOnce(new Error('network'));
    await expect(service.process('123')).rejects.toThrow('network');
    expect(row.status).toBe('failed');
    await service.process('123');
    expect(row.status).toBe('processed');
  });
  it('recovers a persisted notification after an enqueue failure', async () => {
    const { service, queue, row } = setup();
    queue.add.mockRejectedValueOnce(new Error('redis'));
    await expect(service.receive(row)).rejects.toThrow('redis');
    expect(row.status).toBe('received');
    await service.receive(row);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });
  it('resolves an authorized payment to its subscription and includes its exact id', async () => {
    const { service, row, subscriptions } = setup();
    row.type = 'subscription_authorized_payment';
    await service.process('123');
    expect(subscriptions.syncPreapproval).toHaveBeenCalledWith('mp', '123', 'payment');
  });
  it('fetches a one-time payment before invoking the HU-42 extension', async () => {
    const { service, row, effects, client } = setup();
    row.type = 'payment';
    const hook = jest.spyOn(effects, 'onOneTimePayment');
    await service.process('123');
    expect(hook).toHaveBeenCalledWith(await client.getPayment());
  });
  it('mantiene el despacho por prefijo sin ejecutar pagos ajenos', async () => {
    const noop = new NoopSubscriptionEffects({
      approved: jest.fn().mockResolvedValue(undefined),
      rejected: jest.fn().mockResolvedValue(undefined),
      oneTimePayment: jest.fn().mockResolvedValue(undefined),
    } as unknown as GraceService);
    await expect(noop.onChargeApproved({} as SubscriptionCharge)).resolves.toBeUndefined();
    await expect(noop.onChargeRejected({} as SubscriptionCharge)).resolves.toBeUndefined();
    await expect(
      noop.onOneTimePayment({
        id: 'p',
        status: 'approved',
        transaction_amount: '1.00',
        external_reference: 'plan-change:other',
      }),
    ).resolves.toBeUndefined();
  });
});
