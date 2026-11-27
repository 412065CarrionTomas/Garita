import { PlanChangeController } from './plan-change.controller';
import { PlanChangeService } from './plan-change.service';
import { PlanChangeProcessor, PLAN_CHANGE_QUEUE } from './plan-change.processor';
import { GraceService } from './grace.service';
import { GraceController } from './grace.controller';
import { GraceProcessor, SUBSCRIPTION_GRACE_QUEUE } from './grace.processor';
import { ResendInvitationMailer } from '../users/email.service';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { UsersModule } from '../users/users.module';
import { ClockModule } from '../../common/clock';
import { GuardSelectionService } from './guard-selection';
import { NoopSubscriptionEffects, SUBSCRIPTION_EFFECTS_PORT } from './subscription-effects.port';
import { MP_NOTIFICATIONS_QUEUE } from './mercadopago-webhook.service';
import { MercadoPagoNotificationsProcessor } from './mercadopago-notifications.processor';
import {
  MercadoPagoReconciliationProcessor,
  MP_RECONCILIATION_QUEUE,
} from './mercadopago-reconciliation.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { MercadoPagoClient } from './mercadopago.client';
import { MercadoPagoWebhookController } from './mercadopago-webhook.controller';
import { MercadoPagoWebhookService } from './mercadopago-webhook.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SuspensionController } from './suspension.controller';
import { SuspensionService } from './suspension.service';
import { SuspensionProcessor, SUBSCRIPTION_SUSPENSION_QUEUE } from './suspension.processor';

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    ClockModule,
    BullModule.registerQueue(
      { name: MP_NOTIFICATIONS_QUEUE },
      { name: MP_RECONCILIATION_QUEUE },
      { name: PLAN_CHANGE_QUEUE },
      { name: SUBSCRIPTION_GRACE_QUEUE },
      { name: SUBSCRIPTION_SUSPENSION_QUEUE },
    ),
  ],
  controllers: [
    MercadoPagoWebhookController,
    SubscriptionsController,
    PlanChangeController,
    GraceController,
    SuspensionController,
  ],
  providers: [
    PlanChangeService,
    PlanChangeProcessor,
    GraceService,
    GraceProcessor,
    SuspensionService,
    SuspensionProcessor,
    ResendInvitationMailer,
    MercadoPagoClient,
    MercadoPagoWebhookService,
    SubscriptionsService,
    GuardSelectionService,
    MercadoPagoNotificationsProcessor,
    MercadoPagoReconciliationProcessor,
    { provide: SUBSCRIPTION_EFFECTS_PORT, useClass: NoopSubscriptionEffects },
  ],
  exports: [SubscriptionsService, GuardSelectionService],
})
export class SubscriptionsModule {}
