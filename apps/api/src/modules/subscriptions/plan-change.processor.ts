import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { z } from 'zod';
import { CLOCK, type Clock } from '../../common/clock';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlanChangeService } from './plan-change.service';

export const PLAN_CHANGE_QUEUE = 'subscription-plan-change';
const jobSchema = z.object({ kind: z.enum(['sweep', 'daily']) }).strict();

@Processor(PLAN_CHANGE_QUEUE, { concurrency: 1 })
export class PlanChangeProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(PlanChangeProcessor.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly changes: PlanChangeService,
    @Inject(CLOCK) private readonly clock: Clock,
    @InjectQueue(PLAN_CHANGE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    const defaults = {
      attempts: 6,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 100,
    };
    await this.queue.upsertJobScheduler(
      'subscription-plan-change-sweep',
      { every: 300_000 },
      { name: 'sweep', data: { kind: 'sweep' }, opts: defaults },
    );
    await this.queue.upsertJobScheduler(
      'subscription-plan-change-daily',
      { pattern: '15 3 * * *', tz: 'America/Argentina/Buenos_Aires' },
      { name: 'daily', data: { kind: 'daily' }, opts: defaults },
    );
  }

  async process(job: Job<unknown>): Promise<void> {
    const { kind } = jobSchema.parse(job.data);
    // Platform discovery with no authenticated request; mutations use only the discovered rows.
    this.logger.log({
      event: 'subscription.plan_change_system_query',
      kind,
      correlationId: job.id,
    });
    const db = this.prisma.systemPrisma;
    await db.planChangePayment.updateMany({
      where: { status: 'pending', expiresAt: { lte: this.clock.now() } },
      data: {
        status: 'rejected',
        rejectionReason: 'El enlace de pago venció. Podés volver a simular el cambio.',
      },
    });
    const now = this.clock.now();
    // The 5 minute sweep only visits subscriptions with work to do; the daily pass compares
    // the remote amount of every open one.
    const where: Prisma.SubscriptionWhereInput =
      kind === 'daily'
        ? { status: { in: ['pending', 'authorized', 'paused'] }, mpPreapprovalId: { not: null } }
        : {
            OR: [
              {
                status: 'authorized',
                cancelAt: null,
                pendingPlanId: { not: null },
                pendingPlanAt: { lte: now },
              },
              {
                status: { not: 'cancelled' },
                mpPreapprovalId: { not: null },
                planChangePayments: { some: { amountUpdatePending: true } },
              },
            ],
          };
    let failed = false;
    for (let cursor: string | undefined; ;) {
      const batch = await db.subscription.findMany({
        where,
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 50,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const s of batch) {
        try {
          // Pending guards of an applied downgrade are retried by the reconciliation sweep.
          await this.changes.applyDowngrade(s.id);
          await this.changes.repairAmount(s.id, kind === 'daily');
        } catch (error) {
          failed = true;
          this.logger.error({
            event: 'subscription.plan_change_failed',
            subscriptionId: s.id,
            error: String(error),
          });
        }
      }
      if (batch.length < 50) break;
      cursor = batch[batch.length - 1]?.id;
    }
    if (failed) throw new Error('Hay cambios de plan pendientes de reintento.');
  }
}
