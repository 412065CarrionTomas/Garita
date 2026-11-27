import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { GraceService } from './grace.service';

export const SUBSCRIPTION_GRACE_QUEUE = 'subscription-grace';

@Processor(SUBSCRIPTION_GRACE_QUEUE)
export class GraceProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    private readonly grace: GraceService,
    @InjectQueue(SUBSCRIPTION_GRACE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }
  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'subscription-grace-sweep',
      { every: 60_000 },
      {
        name: 'sweep',
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      },
    );
  }
  async process(): Promise<void> {
    await this.grace.sweep();
  }
}
