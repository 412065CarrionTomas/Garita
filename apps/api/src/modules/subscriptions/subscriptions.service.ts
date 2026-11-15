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
import { ACCOUNT_STATE_PORT, type AccountStatePort } from '../../common/ports/account-state.port';
import {
  SUBSCRIPTION_EFFECTS_PORT,
  type SubscriptionEffectsPort,
} from './subscription-effects.port';
import { GuardSelectionService } from './guard-selection';
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
    @Inject(ACCOUNT_STATE_PORT) private readonly account: AccountStatePort,
    @Inject(SUBSCRIPTION_EFFECTS_PORT) private readonly effects: SubscriptionEffectsPort,
    private readonly guardSelection: GuardSelectionService,
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
    adminId: string,
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
    const selection = await this.guardSelection.validate(
      plan.maxGuards,
      input.guardSelection,
      adminId,
    );
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
        data: {
          companyId,
          planId: plan.id,
          payerEmail: input.payerEmail,
          startsAt,
          guardSelection: selection ?? Prisma.DbNull,
        },
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

  async get(companyId: string, chargePage = 1): Promise<SubscriptionResponse> {
    const db = this.prisma.tenantPrisma;
    const company = await db.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { trialEndsAt: true },
    });
    const latest = await db.subscription.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
    if (latest) await this.finishDueCancellation(latest);
    // Pull from Mercado Pago on read so the screen is right even if a webhook was missed.
    if (latest?.mpPreapprovalId && latest.status !== 'cancelled') {
      await this.syncPreapproval(latest.mpPreapprovalId).catch((error: unknown) => {
        this.logger.warn(`No se pudo sincronizar ${latest.mpPreapprovalId}: ${String(error)}`);
      });
    }
    const subscription = latest
      ? await db.subscription.findUniqueOrThrow({
          where: { id: latest.id },
          include: {
            plan: true,
            charges: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              skip: (chargePage - 1) * 24,
              take: 25,
            },
          },
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
        cancelAt: subscription.cancelAt?.toISOString() ?? null,
        chargePage,
        hasMoreCharges: subscription.charges.length > 24,
        charges: subscription.charges.slice(0, 24).map((charge) => ({
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
  async syncPreapproval(
    mpPreapprovalId: string,
    correlationId = mpPreapprovalId,
    paymentId?: string,
    reconciliation = false,
  ): Promise<void> {
    // Webhooks/jobs have no authenticated tenant; serialize all reads and writes for this MP resource.
    this.logger.log({ event: 'subscription.sync_system_query', correlationId, mpPreapprovalId });
    await this.prisma.systemPrisma.$transaction(
      async (db) => {
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${mpPreapprovalId}, 0))`;
        await this.syncLocked(db, mpPreapprovalId, correlationId, paymentId, reconciliation);
      },
      { timeout: 120_000 },
    );
    const subscription = await this.prisma.systemPrisma.subscription.findUnique({
      where: { mpPreapprovalId },
    });
    if (subscription?.status === 'authorized')
      await this.guardSelection.apply(
        subscription.id,
        subscription.companyId,
        subscription.guardSelection,
      );
  }

  private async syncLocked(
    db: Prisma.TransactionClient,
    mpPreapprovalId: string,
    correlationId: string,
    paymentId: string | undefined,
    reconciliation: boolean,
  ): Promise<void> {
    const subscription = await db.subscription.findUnique({ where: { mpPreapprovalId } });
    if (!subscription) {
      this.logger.warn(`Suscripción de Mercado Pago desconocida: ${mpPreapprovalId}`);
      return;
    }
    const [remote, searched] = await Promise.all([
      this.mercadoPago.getPreapproval(mpPreapprovalId),
      this.mercadoPago.searchAuthorizedPayments(mpPreapprovalId),
    ]);
    const payments = [...searched];
    if (paymentId) {
      const current = await this.mercadoPago.getAuthorizedPayment(paymentId);
      const index = payments.findIndex((payment) => payment.id === paymentId);
      if (index < 0) payments.push(current);
      else payments[index] = current;
    }
    if (subscription.status === 'cancelled' && remote.status !== 'cancelled') {
      // A replaced checkout was completed in an old tab: stop it instead of charging twice.
      this.logger.warn(`Se cancela ${mpPreapprovalId}: fue reemplazada por otra suscripción`);
      await this.mercadoPago.cancelPreapproval(mpPreapprovalId);
      return;
    }
    for (const payment of payments) {
      if (payment.preapproval_id !== mpPreapprovalId)
        throw new Error('El cobro pertenece a otra suscripción');
      const before = await db.subscriptionCharge.findUnique({
        where: { mpAuthorizedPaymentId: payment.id },
      });
      const data = {
        mpPaymentId: payment.payment?.id ?? null,
        amount: new Prisma.Decimal(payment.transaction_amount),
        status: toChargeStatus(payment.payment),
        statusDetail: payment.payment?.status_detail ?? null,
        retryAttempt: payment.retry_attempt ?? 0,
        chargedAt: payment.date_created ? new Date(payment.date_created) : null,
      };
      const charge = await db.subscriptionCharge.upsert({
        where: { mpAuthorizedPaymentId: payment.id },
        create: {
          ...data,
          mpAuthorizedPaymentId: payment.id,
          companyId: subscription.companyId,
          subscriptionId: subscription.id,
        },
        update: data,
      });
      if (
        reconciliation &&
        (before?.status !== charge.status ||
          before.retryAttempt !== charge.retryAttempt ||
          !before.amount.equals(charge.amount) ||
          before.statusDetail !== charge.statusDetail ||
          before.mpPaymentId !== charge.mpPaymentId ||
          before.chargedAt?.getTime() !== charge.chargedAt?.getTime())
      ) {
        this.logger.error({
          event: 'subscription.reconciliation_diff',
          correlationId,
          subscriptionId: subscription.id,
          chargeId: charge.id,
          before: before?.status ?? null,
          corrected: charge.status,
        });
      }
      if (before?.status !== charge.status && charge.status !== 'pending') {
        this.logger.log({
          event: 'subscription.metric',
          correlationId,
          metric: 'charges',
          status: charge.status,
          value: 1,
        });
      }
      if (charge.effectsAppliedStatus !== charge.status && charge.status !== 'pending') {
        if (charge.status === 'approved') await this.effects.onChargeApproved(charge);
        else await this.effects.onChargeRejected(charge);
        await db.subscriptionCharge.update({
          where: { id: charge.id },
          data: { effectsAppliedStatus: charge.status },
        });
      }
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
    if (
      reconciliation &&
      (status !== subscription.status ||
        subscription.nextChargeAt?.toISOString() !==
          (remote.next_payment_date ? new Date(remote.next_payment_date).toISOString() : undefined))
    ) {
      this.logger.error({
        event: 'subscription.reconciliation_diff',
        correlationId,
        subscriptionId: subscription.id,
        before: { status: subscription.status, nextChargeAt: subscription.nextChargeAt },
        corrected: { status, nextChargeAt: remote.next_payment_date ?? null },
      });
    }
    if (status !== subscription.status) {
      this.logger.log({
        event: 'subscription.metric',
        correlationId,
        metric: 'subscriptions',
        status,
        value: 1,
      });
    }
    if (status === 'authorized' && subscription.status === 'pending') {
      const account = await this.account.get(subscription.companyId);
      if (!(account.status === 'trial' && subscription.startsAt > this.clock.now())) {
        await this.account.transition({ companyId: subscription.companyId, to: 'active' });
      }
    }
  }

  /**
   * HU-42: the service keeps running until the end of the paid cycle. The debit is paused (not
   * cancelled) in Mercado Pago so the admin can still revert; a pending checkout has no paid
   * cycle and is dropped right away.
   */
  async cancel(
    companyId: string,
    userId: string,
    reason: string | undefined,
  ): Promise<SubscriptionResponse> {
    const db = this.prisma.tenantPrisma;
    const open = await db.subscription.findFirst({
      where: { companyId, status: { in: OPEN_STATUSES } },
    });
    if (!open) throw new NotFoundException('No hay una suscripción para cancelar');
    if (open.cancelAt) throw new ConflictException('La suscripción ya está cancelada');
    if (open.status === 'pending') {
      await this.cancelPending(open.id, open.mpPreapprovalId);
      return this.get(companyId);
    }
    if (open.status !== 'authorized' || !open.mpPreapprovalId) {
      throw new ConflictException('La suscripción no se puede cancelar en este estado');
    }
    // The next charge date is where the paid cycle ends; refresh it before relying on it.
    await this.syncPreapproval(open.mpPreapprovalId);
    const fresh = await db.subscription.findUniqueOrThrow({ where: { id: open.id } });
    const now = this.clock.now();
    const cancelAt = fresh.nextChargeAt && fresh.nextChargeAt > now ? fresh.nextChargeAt : now;
    await this.mercadoPago.setPreapprovalStatus(open.mpPreapprovalId, 'paused');
    await db.subscription.update({
      where: { id: open.id },
      data: {
        status: 'paused',
        cancelAt,
        cancelReason: reason ?? null,
        cancelRequestedAt: now,
        cancelRequestedById: userId,
      },
    });
    return this.get(companyId);
  }

  async revertCancellation(companyId: string): Promise<SubscriptionResponse> {
    const db = this.prisma.tenantPrisma;
    const scheduled = await db.subscription.findFirst({
      where: { companyId, status: 'paused', cancelAt: { not: null } },
    });
    if (!scheduled?.cancelAt || !scheduled.mpPreapprovalId) {
      throw new NotFoundException('No hay una cancelación para revertir');
    }
    if (scheduled.cancelAt <= this.clock.now()) {
      throw new ConflictException('El ciclo pagado ya terminó: volvé a suscribirte');
    }
    await this.mercadoPago.setPreapprovalStatus(scheduled.mpPreapprovalId, 'authorized');
    await db.subscription.update({
      where: { id: scheduled.id },
      data: {
        status: 'authorized',
        cancelAt: null,
        cancelReason: null,
        cancelRequestedAt: null,
        cancelRequestedById: null,
      },
    });
    return this.get(companyId);
  }

  async finishDueCancellation(subscription: {
    id: string;
    companyId: string;
    status: SubscriptionStatus;
    cancelAt: Date | null;
    mpPreapprovalId: string | null;
  }): Promise<void> {
    if (!subscription.cancelAt || subscription.status === 'cancelled') return;
    if (subscription.cancelAt > this.clock.now()) return;
    if (subscription.mpPreapprovalId) {
      // If Mercado Pago fails, the row stays paused and the next read retries.
      await this.mercadoPago.cancelPreapproval(subscription.mpPreapprovalId);
    }
    await this.prisma.systemPrisma.subscription.update({
      where: { id: subscription.id, companyId: subscription.companyId },
      data: { status: 'cancelled' },
    });
    subscription.status = 'cancelled';
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
