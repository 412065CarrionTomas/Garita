import { Injectable, Logger } from '@nestjs/common';
import { MercadoPagoClient } from './mercadopago.client';
import { SubscriptionsService } from './subscriptions.service';

/**
 * shortcut: runs in-process after answering; BullMQ, retries and the notification log
 * (ID-336) come next. The body is never trusted: state is always pulled from Mercado Pago.
 */
@Injectable()
export class MercadoPagoWebhookService {
  private readonly logger = new Logger(MercadoPagoWebhookService.name);

  constructor(
    private readonly mercadoPago: MercadoPagoClient,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async handle(type: string, id: string): Promise<void> {
    try {
      if (type === 'subscription_preapproval') {
        await this.subscriptions.syncPreapproval(id);
      } else if (type === 'subscription_authorized_payment') {
        const payment = await this.mercadoPago.getAuthorizedPayment(id);
        await this.subscriptions.syncPreapproval(payment.preapproval_id);
      } else {
        this.logger.log(`Aviso de Mercado Pago ignorado: tipo ${type}`);
        return;
      }
      this.logger.log(`Aviso ${type} ${id} sincronizado`);
    } catch (error) {
      this.logger.error(
        `No se pudo procesar el aviso ${type} ${id}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
