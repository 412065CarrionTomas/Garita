import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { SHIFT_AUTO_CLOSE_QUEUE, ShiftExecutionService } from './shift-execution.service';

@Processor(SHIFT_AUTO_CLOSE_QUEUE)
export class ShiftAutoCloseProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    private readonly execution: ShiftExecutionService,
    @InjectQueue(SHIFT_AUTO_CLOSE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }
  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'shift-auto-close-sweep',
      { every: 60_000 },
      { name: 'sweep', data: {} },
    );
  }
  async process(job: Job<{ shiftId?: string }>): Promise<unknown> {
    if (job.name === 'sweep') return this.execution.closeExpired();
    if (!job.data.shiftId) return false;
    return this.execution.autoClose(job.data.shiftId);
  }
}
