import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  PanicJobsService,
  PANIC_SMS_QUEUE,
  PANIC_ESCALATION_QUEUE,
  panicJobSchema,
  panicSmsJobSchema,
} from './panic-jobs.service';

@Processor(PANIC_SMS_QUEUE)
export class PanicSmsProcessor extends WorkerHost {
  constructor(private readonly jobs: PanicJobsService) {
    super();
  }
  async process(job: Job<unknown>) {
    await this.jobs.sendSms(panicSmsJobSchema.parse(job.data));
  }
}

@Processor(PANIC_ESCALATION_QUEUE)
export class PanicEscalationProcessor extends WorkerHost {
  constructor(private readonly jobs: PanicJobsService) {
    super();
  }
  async process(job: Job<unknown>) {
    await this.jobs.escalate(panicJobSchema.parse(job.data));
  }
}
