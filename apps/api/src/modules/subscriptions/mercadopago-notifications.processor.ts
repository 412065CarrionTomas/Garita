import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  MercadoPagoWebhookService,
  MP_NOTIFICATIONS_QUEUE,
  notificationJobSchema,
} from './mercadopago-webhook.service';
import { MercadoPagoRetryableError } from './mercadopago.client';

@Processor(MP_NOTIFICATIONS_QUEUE, {
  concurrency: 1,
  settings: {
    backoffStrategy: (attemptsMade, _type, error) =>
      Math.max(
        5000 * 2 ** (attemptsMade - 1),
        error instanceof MercadoPagoRetryableError ? error.retryAfterMs : 0,
      ),
  },
})
export class MercadoPagoNotificationsProcessor extends WorkerHost {
  constructor(private readonly webhook: MercadoPagoWebhookService) {
    super();
  }
  async process(job: Job<unknown>): Promise<void> {
    await this.webhook.process(notificationJobSchema.parse(job.data).notificationId);
  }
}
