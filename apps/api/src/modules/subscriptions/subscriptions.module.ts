import { Module } from '@nestjs/common';
import { MercadoPagoWebhookController } from './mercadopago-webhook.controller';
import { MercadoPagoWebhookService } from './mercadopago-webhook.service';

@Module({
  controllers: [MercadoPagoWebhookController],
  providers: [MercadoPagoWebhookService],
})
export class SubscriptionsModule {}
