import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { z } from 'zod';
import { OPEN_SUBSCRIPTION_STATUSES } from '@garita/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from './subscriptions.service';
import { GuardSelectionService } from './guard-selection';
import { MercadoPagoRetryableError } from './mercadopago.client';
import { MercadoPagoWebhookService } from './mercadopago-webhook.service';

export const MP_RECONCILIATION_QUEUE = 'mercadopago-reconciliation';
const jobSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily') }).strict(),
  z.object({ kind: z.literal('pending') }).strict(),
  z.object({ kind: z.literal('subscription'), id: z.string().min(1) }).strict(),
]);

@Processor(MP_RECONCILIATION_QUEUE, {
  concurrency: 1,
  limiter: { max: 1, duration: 1000 },
  settings: {
    backoffStrategy: (attempt, _type, error) =>
      Math.max(
        5000 * 2 ** (attempt - 1),
        error instanceof MercadoPagoRetryableError ? error.retryAfterMs : 0,
      ),
  },
})
export class MercadoPagoReconciliationProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(MercadoPagoReconciliationProcessor.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly selection: GuardSelectionService,
    private readonly webhook: MercadoPagoWebhookService,
    @InjectQueue(MP_RECONCILIATION_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'mercadopago-daily',
      { pattern: '0 3 * * *', tz: 'America/Argentina/Buenos_Aires' },
      { name: 'daily', data: { kind: 'daily' } },
    );
    // shortcut: pending guards are deactivated up to 5 min after close; use a close hook if faster application is required.
    await this.queue.upsertJobScheduler(
      'mercadopago-pending-guards',
      { every: 300_000 },
      { name: 'pending', data: { kind: 'pending' } },
    );
  }

  async process(job: Job<unknown>): Promise<void> {
    const input = jobSchema.parse(job.data);
    // Background discovery is platform-wide; subsequent mutations use only IDs read from these rows.
    this.logger.log({
      event: 'subscription.reconciliation_system_query',
      correlationId: job.id,
      kind: input.kind,
    });
    const db = this.prisma.systemPrisma;
    if (input.kind === 'subscription') {
      const subscription = await db.subscription.findUniqueOrThrow({ where: { id: input.id } });
      const before = subscription.status;
      await this.subscriptions.finishDueCancellation(subscription);
      if (before !== subscription.status)
        this.logger.error({
          event: 'subscription.reconciliation_diff',
          subscriptionId: subscription.id,
          before,
          corrected: subscription.status,
        });
      if (subscription.status !== 'cancelled' && subscription.mpPreapprovalId)
        await this.subscriptions.syncPreapproval(
          subscription.mpPreapprovalId,
          job.id,
          undefined,
          true,
        );
      return;
    }
    for (let cursor: string | undefined; ;) {
      const batch = await db.subscription.findMany({
        where:
          input.kind === 'daily'
            ? { status: { in: [...OPEN_SUBSCRIPTION_STATUSES] } }
            : { status: 'authorized', guardSelection: { not: Prisma.DbNull } },
        orderBy: { id: 'asc' },
        take: 50,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const subscription of batch) {
        if (input.kind === 'daily')
          await this.queue.add(
            'subscription',
            { kind: 'subscription', id: subscription.id },
            {
              jobId: `reconcile-${job.id?.replaceAll(':', '-')}-${subscription.id}`,
              attempts: 6,
              backoff: { type: 'custom' },
              removeOnComplete: true,
              removeOnFail: 100,
            },
          );
        try {
          if (subscription.status === 'authorized')
            await this.selection.apply(
              subscription.id,
              subscription.companyId,
              subscription.guardSelection,
            );
        } catch (error) {
          this.logger.error({
            event: 'subscription.guard_selection_failed',
            subscriptionId: subscription.id,
            error: error instanceof Error ? error.message : 'Error desconocido',
          });
        }
      }
      if (batch.length < 50) break;
      cursor = batch[batch.length - 1]?.id;
    }
    if (input.kind === 'pending') {
      const pending = await db.mercadoPagoNotification.findMany({
        where: { status: 'received' },
        orderBy: { receivedAt: 'asc' },
        take: 50,
      });
      for (const notification of pending) await this.webhook.receive(notification);
    }
  }
}
