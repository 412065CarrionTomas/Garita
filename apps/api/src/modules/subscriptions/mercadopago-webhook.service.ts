import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';

const RESOURCE_PATHS: Record<string, (id: string) => string> = {
  subscription_preapproval: (id) => `/preapproval/${id}`,
  subscription_authorized_payment: (id) => `/authorized_payments/${id}`,
  subscription_preapproval_plan: (id) => `/preapproval_plan/${id}`,
  payment: (id) => `/v1/payments/${id}`,
};

/**
 * shortcut: only fetches and logs the real state; persistence (ID-334), BullMQ and
 * idempotency (ID-336) come next.
 */
@Injectable()
export class MercadoPagoWebhookService {
  private readonly logger = new Logger(MercadoPagoWebhookService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async handle(type: string, id: string): Promise<void> {
    const path = RESOURCE_PATHS[type];
    if (!path) {
      this.logger.log(`Aviso de Mercado Pago ignorado: tipo ${type}`);
      return;
    }
    const token = this.config.get('MERCADOPAGO_ACCESS_TOKEN', { infer: true });
    if (!token) {
      this.logger.warn('Falta MERCADOPAGO_ACCESS_TOKEN: no se consulta el estado');
      return;
    }
    try {
      // The notification body is never trusted: the state always comes from Mercado Pago's API.
      const res = await fetch(`https://api.mercadopago.com${path(encodeURIComponent(id))}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.logger.warn(`Mercado Pago respondió ${res.status} al consultar ${type} ${id}`);
        return;
      }
      const resource = (await res.json()) as Record<string, unknown>;
      this.logger.log(
        `Estado real de ${type} ${id}: ${JSON.stringify({
          status: resource.status,
          external_reference: resource.external_reference,
          preapproval_id: resource.preapproval_id,
          payment: resource.payment,
        })}`,
      );
    } catch (error) {
      this.logger.error(
        `No se pudo consultar ${type} ${id}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
