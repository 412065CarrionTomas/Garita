import { InjectQueue } from '@nestjs/bullmq';

import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';

import type { Queue } from 'bullmq';

import { z } from 'zod';

import { PrismaService } from '../prisma/prisma.service';

import { MercadoPagoClient } from './mercadopago.client';

import { SubscriptionsService } from './subscriptions.service';

import {
  SUBSCRIPTION_EFFECTS_PORT,
  type SubscriptionEffectsPort,
} from './subscription-effects.port';

export const MP_NOTIFICATIONS_QUEUE = 'mercadopago-notifications';

export const notificationJobSchema = z.object({ notificationId: z.string().min(1) }).strict();

@Injectable()
export class MercadoPagoWebhookService {
  private readonly logger = new Logger(MercadoPagoWebhookService.name);

  constructor(
    private readonly mercadoPago: MercadoPagoClient,

    private readonly subscriptions: SubscriptionsService,

    private readonly prisma: PrismaService,

    @InjectQueue(MP_NOTIFICATIONS_QUEUE) private readonly queue: Queue,

    @Inject(SUBSCRIPTION_EFFECTS_PORT) private readonly effects: SubscriptionEffectsPort,
  ) {}

  async receive(input: { id: string; type: string; action?: string | null; resourceId: string }) {
    // Public endpoint: notification IDs are platform-wide; no tenant is asserted by the sender.

    const db = this.prisma.systemPrisma;

    const notification = await db.mercadoPagoNotification.upsert({
      where: { id: input.id },
      create: input,
      update: {},
    });

    if (notification.type !== input.type || notification.resourceId !== input.resourceId)
      throw new ConflictException('El aviso ya existe para otro recurso');

    if (notification.status === 'processed') return;

    await this.queue.add(
      'process',
      { notificationId: input.id },
      {
        jobId: input.id,
        attempts: 6,
        backoff: { type: 'custom', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    this.logger.log({
      event: 'subscription.notification',
      correlationId: input.id,
      result: 'queued',
    });
  }

  async process(notificationId: string): Promise<void> {
    const db = this.prisma.systemPrisma;

    const notification = await db.mercadoPagoNotification.findUniqueOrThrow({
      where: { id: notificationId },
    });

    if (notification.status === 'processed') return;

    try {
      if (notification.type === 'subscription_preapproval') {
        await this.subscriptions.syncPreapproval(notification.resourceId, notificationId);
      } else if (notification.type === 'subscription_authorized_payment') {
        const payment = await this.mercadoPago.getAuthorizedPayment(notification.resourceId);

        await this.subscriptions.syncPreapproval(
          payment.preapproval_id,
          notificationId,
          payment.id,
        );
      } else if (notification.type === 'payment') {
        await this.effects.onOneTimePayment(
          await this.mercadoPago.getPayment(notification.resourceId),
        );
      }

      await db.mercadoPagoNotification.update({
        where: { id: notificationId },
        data: { status: 'processed', error: null, processedAt: new Date() },
      });

      this.logger.log({
        event: 'subscription.notification',
        correlationId: notificationId,
        result: 'processed',
      });
    } catch (error) {
      await db.mercadoPagoNotification.update({
        where: { id: notificationId },
        data: {
          status: 'failed',
          error: error instanceof Error ? error.message.slice(0, 1000) : 'Error desconocido',
        },
      });

      this.logger.error({
        event: 'subscription.notification',
        correlationId: notificationId,
        result: 'failed',
      });

      throw error;
    }
  }
}
