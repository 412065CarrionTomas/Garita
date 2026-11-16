import { PlanChangeService } from './plan-change.service';
import { Injectable, Logger } from '@nestjs/common';
import type { SubscriptionCharge } from '../../generated/prisma/client';
import type { MercadoPagoPayment } from './mercadopago.client';

/** Effects must be idempotent by charge/payment id and status: a failed delivery is retried. */
export interface SubscriptionEffectsPort {
  onChargeRejected(charge: SubscriptionCharge): Promise<void>;
  onChargeApproved(charge: SubscriptionCharge): Promise<void>;
  onOneTimePayment(payment: MercadoPagoPayment): Promise<void>;
}
export const SUBSCRIPTION_EFFECTS_PORT = Symbol('SUBSCRIPTION_EFFECTS_PORT');

@Injectable()
export class NoopSubscriptionEffects implements SubscriptionEffectsPort {
  private readonly logger = new Logger(NoopSubscriptionEffects.name);
  constructor(private readonly changes: PlanChangeService) {}
  onChargeRejected(): Promise<void> {
    return Promise.resolve();
  }
  onChargeApproved(): Promise<void> {
    return Promise.resolve();
  }
  onOneTimePayment(payment: MercadoPagoPayment): Promise<void> {
    if (payment.external_reference?.startsWith('plan-change:'))
      return this.changes.onPayment(payment);
    this.logger.log({ event: 'subscription.one_time_payment_ignored', paymentId: payment.id });
    return Promise.resolve();
  }
}
