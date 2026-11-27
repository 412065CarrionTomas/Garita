import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AccountTrialService } from './account-trial.service';

export const ACCOUNT_TRIAL_QUEUE = 'account-trial';

@Processor(ACCOUNT_TRIAL_QUEUE)
export class AccountTrialProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    private readonly trial: AccountTrialService,
    @InjectQueue(ACCOUNT_TRIAL_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }
  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'account-trial-sweep',
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
    await this.trial.sweep();
  }
}
