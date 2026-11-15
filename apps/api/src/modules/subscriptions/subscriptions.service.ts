import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OPEN_SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUSES,
  type CreateSubscriptionRequest,
  type CreateSubscriptionResponse,
  type PlanResponse,
  type SubscriptionChargeStatus,
  type SubscriptionResponse,
  type SubscriptionStatus,
} from '@garita/shared';
import { CLOCK, type Clock } from '../../common/clock';
import type { Env } from '../../config/env';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MercadoPagoClient, type MercadoPagoAuthorizedPayment } from './mercadopago.client';

const OPEN_STATUSES = [...OPEN_SUBSCRIPTION_STATUSES];

interface PlanRow {
  id: string;
  name: string;
  monthlyPrice: Prisma.Decimal;
  maxGuards: number;
}

function toPlanResponse(plan: PlanRow): PlanResponse {
  return {
    id: plan.id,
    name: plan.name,
    monthlyPrice: plan.monthlyPrice.toFixed(2),
    maxGuards: plan.maxGuards,
  };
}

/** Mercado Pago may add statuses; anything unknown keeps the stored one. */
function toSubscriptionStatus(status: string): SubscriptionStatus | undefined {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(status)
    ? (status as SubscriptionStatus)
    : undefined;
}

function toChargeStatus(
  payment: MercadoPagoAuthorizedPayment['payment'],
): SubscriptionChargeStatus {
  if (payment?.status === 'approved') return 'approved';
  if (payment?.status === 'rejected' || payment?.status === 'cancelled') return 'rejected';
  return 'pending';
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mercadoPago: MercadoPagoClient,
    private readonly config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async listPlans(): Promise<PlanResponse[]> {
    const plans = await this.prisma.tenantPrisma.plan.findMany({
      where: { active: true },
      orderBy: { maxGuards: 'asc' },
    });
    return plans.map(toPlanResponse);
  }

  async create(
    companyId: string,
    input: CreateSubscriptionRequest,
  ): Promise<CreateSubscriptionResponse> {
    const db = this.prisma.tenantPrisma;
    const plan = await db.plan.findFirst({ where: { id: input.planId, active: true } });
    if (!plan) throw new NotFoundException('El plan no existe');

    const open = await db.subscription.findFirst({
      where: { companyId, status: { in: OPEN_STATUSES } },
    });
    if (open && open.status !== 'pending') {
      throw new ConflictException('La empresa ya tiene una suscripción activa');
    }
    // An abandoned checkout is replaced so the admin can pick another plan or payer.
    if (open) await this.cancelPending(open.id, open.mpPreapprovalId);

    const now = this.clock.now();
    const company = await db.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { trialEndsAt: true },
    });
    const trialEndsAt = company.trialEndsAt;
    const deferred = input.keepTrial && trialEndsAt !== null && trialEndsAt > now;
    const startsAt = deferred ? trialEndsAt : now;

    const subscription = await db.subscription
      .create({
        data: { companyId, planId: plan.id, payerEmail: input.payerEmail, startsAt },
      })
      .catch((error: unknown) => {
        // Partial unique index: another request opened a subscription at the same time.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('La empresa ya tiene una suscripción en curso');
        }
        throw error;
      });

    try {
      const preapproval = await this.mercadoPago.createPreapproval({
        reason: `Garita - ${plan.name}`,
        externalReference: subscription.id,
        payerEmail: input.payerEmail,
        backUrl: `${this.config.get('WEB_APP_URL', { infer: true })}/suscripcion`,
        amount: plan.monthlyPrice.toNumber(),
        startDate: deferred ? startsAt : undefined,
      });
      await db.subscription.update({
        where: { id: subscription.id },
        data: { mpPreapprovalId: preapproval.id },
      });
      if (!preapproval.init_point) throw new Error('Mercado Pago no devolvió el enlace de pago');
      return { initPoint: preapproval.init_point };
    } catch (error) {
      // Never leave an open row without its Mercado Pago counterpart: it would block retries.
      await db.subscription.update({
        where: { id: subscription.id },
        data: { status: 'cancelled', lastFailureReason: 'No se pudo crear en Mercado Pago' },
      });
      throw error;
    }
  }

  async get(companyId: string): Promise<SubscriptionResponse> {
    const db = this.prisma.tenantPrisma;
    const company = await db.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { trialEndsAt: true },
    });
    const latest = await db.subscription.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
    // Pull from Mercado Pago on read so the screen is right even if a webhook was missed.
    if (latest?.mpPreapprovalId && latest.status !== 'cancelled') {
      await this.syncPreapproval(latest.mpPreapprovalId).catch((error: unknown) => {
        this.logger.warn(`No se pudo sincronizar ${latest.mpPreapprovalId}: ${String(error)}`);
      });
    }
    const subscription = latest
      ? await db.subscription.findUniqueOrThrow({
          where: { id: latest.id },
          include: { plan: true, charges: { orderBy: { createdAt: 'desc' } } },
        })
      : null;
    return {
      trialEndsAt: company.trialEndsAt?.toISOString() ?? null,
      subscription: subscription && {
        id: subscription.id,
        status: subscription.status,
        plan: toPlanResponse(subscription.plan),
        payerEmail: subscription.payerEmail,
        startsAt: subscription.startsAt.toISOString(),
        nextChargeAt: subscription.nextChargeAt?.toISOString() ?? null,
        lastFailureReason: subscription.lastFailureReason,
        charges: subscription.charges.map((charge) => ({
          id: charge.id,
          amount: charge.amount.toFixed(2),
          status: charge.status,
          statusDetail: charge.statusDetail,
          chargedAt: charge.chargedAt?.toISOString() ?? null,
        })),
      },
    };
  }

  /**
   * Copies the real state of a preapproval and its charges from Mercado Pago. Idempotent:
   * running it twice with the same remote state changes nothing. Used by reads and webhooks.
   */
  async syncPreapproval(mpPreapprovalId: string): Promise<void> {
    const db = this.prisma.systemPrisma;
    const subscription = await db.subscription.findUnique({ where: { mpPreapprovalId } });
    if (!subscription) {
      this.logger.warn(`Suscripción de Mercado Pago desconocida: ${mpPreapprovalId}`);
      return;
    }
    const [remote, payments] = await Promise.all([
      this.mercadoPago.getPreapproval(mpPreapprovalId),
      this.mercadoPago.searchAuthorizedPayments(mpPreapprovalId),
    ]);
    if (subscription.status === 'cancelled' && remote.status !== 'cancelled') {
      // A replaced checkout was completed in an old tab: stop it instead of charging twice.
      this.logger.warn(`Se cancela ${mpPreapprovalId}: fue reemplazada por otra suscripción`);
      await this.mercadoPago.cancelPreapproval(mpPreapprovalId);
      return;
    }
    for (const payment of payments) {
      const data = {
        mpPaymentId: payment.payment?.id ?? null,
        amount: new Prisma.Decimal(payment.transaction_amount.toFixed(2)),
        status: toChargeStatus(payment.payment),
        statusDetail: payment.payment?.status_detail ?? null,
        retryAttempt: payment.retry_attempt ?? 0,
        chargedAt: payment.date_created ? new Date(payment.date_created) : null,
      };
      await db.subscriptionCharge.upsert({
        where: { mpAuthorizedPaymentId: payment.id },
        create: {
          ...data,
          mpAuthorizedPaymentId: payment.id,
          companyId: subscription.companyId,
          subscriptionId: subscription.id,
        },
        update: data,
      });
    }
    const lastRejected = payments.find((payment) => toChargeStatus(payment.payment) === 'rejected');
    const status = toSubscriptionStatus(remote.status) ?? subscription.status;
    await db.subscription.update({
      where: { id: subscription.id },
      data: {
        status,
        nextChargeAt: remote.next_payment_date ? new Date(remote.next_payment_date) : null,
        lastFailureReason:
          status === 'authorized' ? null : (lastRejected?.payment?.status_detail ?? null),
      },
    });
  }

  private async cancelPending(id: string, mpPreapprovalId: string | null): Promise<void> {
    if (mpPreapprovalId) {
      await this.mercadoPago.cancelPreapproval(mpPreapprovalId).catch((error: unknown) => {
        this.logger.warn(
          `No se pudo cancelar ${mpPreapprovalId} en Mercado Pago: ${String(error)}`,
        );
      });
    }
    await this.prisma.tenantPrisma.subscription.update({
      where: { id },
      data: { status: 'cancelled' },
    });
  }
}
