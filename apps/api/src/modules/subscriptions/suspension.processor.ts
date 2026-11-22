import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { SuspensionService } from './suspension.service';

export const SUBSCRIPTION_SUSPENSION_QUEUE = 'subscription-suspension';
@Processor(SUBSCRIPTION_SUSPENSION_QUEUE)
export class SuspensionProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    private readonly suspension: SuspensionService,
    @InjectQueue(SUBSCRIPTION_SUSPENSION_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }
  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'subscription-suspension-sweep',
      { every: 15_000 },
      {
        name: 'sweep',
        data: {},
        opts: {
          attempts: 6,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      },
    );
  }
  async process(): Promise<void> {
    await this.suspension.sweep();
  }
}
