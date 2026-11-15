import { Injectable } from '@nestjs/common';
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
  onChargeRejected(): Promise<void> {
    return Promise.resolve();
  }
  onChargeApproved(): Promise<void> {
    return Promise.resolve();
  }
  onOneTimePayment(): Promise<void> {
    return Promise.resolve();
  }
}
