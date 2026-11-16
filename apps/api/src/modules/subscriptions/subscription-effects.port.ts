import { Injectable, Logger } from '@nestjs/common';
import type { SubscriptionCharge } from '../../generated/prisma/client';
import type { MercadoPagoPayment } from './mercadopago.client';
import { GraceService } from './grace.service';

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
  constructor(private readonly grace: GraceService) {}
  onChargeRejected(charge: SubscriptionCharge): Promise<void> {
    return this.grace.rejected(charge);
  }
  onChargeApproved(charge: SubscriptionCharge): Promise<void> {
    return this.grace.approved(charge);
  }
  onOneTimePayment(payment: MercadoPagoPayment): Promise<void> {
    if (payment.external_reference?.startsWith('grace:')) return this.grace.oneTimePayment(payment);
    this.logger.log({ event: 'subscription.payment_ignored', paymentId: payment.id });
    return Promise.resolve();
  }
}
