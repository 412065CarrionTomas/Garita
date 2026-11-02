import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { CoverageNoticesService } from './coverage-notices.service';

export const COVERAGE_NOTICES_QUEUE = 'coverage-notices';
@Processor(COVERAGE_NOTICES_QUEUE)
export class CoverageNoticesProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    private readonly coverage: CoverageNoticesService,
    @InjectQueue(COVERAGE_NOTICES_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }
  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'coverage-notices-sweep',
      { every: 60_000 },
      { name: 'sweep', data: {} },
    );
  }
  async process(): Promise<void> {
    await this.coverage.sweep();
  }
}
