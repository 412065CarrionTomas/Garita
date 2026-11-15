import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MercadoPagoClient } from './mercadopago.client';
import { MercadoPagoWebhookController } from './mercadopago-webhook.controller';
import { MercadoPagoWebhookService } from './mercadopago-webhook.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [PrismaModule],
  controllers: [MercadoPagoWebhookController, SubscriptionsController],
  providers: [MercadoPagoClient, MercadoPagoWebhookService, SubscriptionsService],
})
export class SubscriptionsModule {}
