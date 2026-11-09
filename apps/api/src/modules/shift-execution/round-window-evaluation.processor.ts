import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Queue } from 'bullmq';
import { RoundWindowStateService } from '../supervision/round-window-state.service';

export const ROUND_WINDOW_EVALUATION_QUEUE = 'round-window-evaluation';

@Processor(ROUND_WINDOW_EVALUATION_QUEUE)
export class RoundWindowEvaluationProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(RoundWindowEvaluationProcessor.name);
  constructor(
    private readonly windows: RoundWindowStateService,
    @InjectQueue(ROUND_WINDOW_EVALUATION_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'round-window-evaluation-sweep',
      { every: 60_000 },
      { name: 'sweep', data: {} },
    );
  }

  async process(job: Job): Promise<void> {
    this.logger.log({ event: 'round_window.sweep', correlationId: job.id });
    await this.windows.recalculateExpired();
  }
}
