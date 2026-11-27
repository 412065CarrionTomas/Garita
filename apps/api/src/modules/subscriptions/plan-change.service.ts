import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  daysLeft,
  guardSelectionRequiredSchema,
  proratePlanChange,
  type PlanChangeRequest,
} from '@garita/shared';
import { CLOCK, type Clock } from '../../common/clock';
import type { Env } from '../../config/env';
import { Prisma, type Subscription } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GuardSelectionService } from './guard-selection';
import { MercadoPagoClient, type MercadoPagoPayment } from './mercadopago.client';

@Injectable()
export class PlanChangeService {
  private readonly logger = new Logger(PlanChangeService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly mercadoPago: MercadoPagoClient,
    private readonly selection: GuardSelectionService,
    private readonly config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async current(db: Prisma.TransactionClient, companyId: string) {
    const row = await db.subscription.findFirst({
      where: { companyId, status: { in: ['pending', 'authorized', 'paused'] } },
      include: { plan: true, company: true },
    });
    if (!row)
      throw new ConflictException(
        'Todavía no tenés una suscripción: elegí el plan al suscribirte.',
      );
    if (row.cancelAt || row.status !== 'authorized' || !row.mpPreapprovalId)
      throw new ConflictException(
        'Revertí la cancelación o autorizá la suscripción antes de cambiar de plan.',
      );
    return { ...row, mpPreapprovalId: row.mpPreapprovalId };
  }

  private async quote(db: Prisma.TransactionClient, companyId: string, planId: string) {
    const subscription = await this.current(db, companyId);
    const plan = await db.plan.findFirst({ where: { id: planId, active: true } });
    if (!plan) throw new NotFoundException('El plan no existe');
    const now = this.clock.now();
    const inTrial = subscription.company.accountStatus === 'trial' && subscription.startsAt > now;
    const undo = subscription.planId === planId && subscription.pendingPlanId !== null;
    if (subscription.planId === planId && !undo)
      throw new BadRequestException('Ya tenés ese plan.');
    if (
      await db.planChangePayment.count({
        where: { subscriptionId: subscription.id, status: 'pending' },
      })
    )
      throw new ConflictException(
        'Tenés un pago de diferencia pendiente. Esperá su resultado o vencimiento.',
      );
    const upgrade = plan.monthlyPrice.greaterThan(subscription.plan.monthlyPrice);
    if (upgrade && subscription.pendingPlanId)
      throw new ConflictException(
        'Anulá la baja pendiente eligiendo el plan vigente antes de subir.',
      );
    let cycleDays = 1;
    let remainingDays = 0;
    if (!inTrial && !undo) {
      const lastCharge = await db.subscriptionCharge.findFirst({
        where: { subscriptionId: subscription.id, status: 'approved', chargedAt: { not: null } },
        orderBy: { chargedAt: 'desc' },
      });
      const end = subscription.nextChargeAt;
      if (!end || end <= now || !lastCharge?.chargedAt || lastCharge.chargedAt >= end)
        throw new ConflictException('No hay un ciclo pagado vigente para calcular el cambio.');
      // daysLeft includes today: subtract the exclusive end date; last cycle day is one day.
      cycleDays = Math.max(
        1,
        daysLeft(end, lastCharge.chargedAt, subscription.company.timezone) - 1,
      );
      remainingDays = Math.min(
        cycleDays,
        Math.max(1, daysLeft(end, now, subscription.company.timezone) - 1),
      );
    }
    const type = undo
      ? ('downgrade_cancelled' as const)
      : upgrade
        ? ('upgrade' as const)
        : ('downgrade' as const);
    return {
      subscription,
      plan,
      inTrial,
      type,
      cycleDays,
      remainingDays,
      amount: proratePlanChange({
        currentPrice: subscription.plan.monthlyPrice.toFixed(2),
        newPrice: plan.monthlyPrice.toFixed(2),
        remainingDays: String(remainingDays),
        cycleDays: String(cycleDays),
        inTrial,
      }),
      effectiveAt: inTrial || upgrade || undo ? now : (subscription.nextChargeAt ?? now),
      cycleEndsAt: subscription.nextChargeAt ?? now,
    };
  }

  async simulate(companyId: string, adminId: string, planId: string) {
    const quote = await this.quote(
      this.prisma.tenantPrisma as unknown as Prisma.TransactionClient,
      companyId,
      planId,
    );
    let required = null;
    if (quote.type === 'downgrade') {
      try {
        await this.selection.validate(quote.plan.maxGuards, undefined, adminId);
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        required = guardSelectionRequiredSchema.parse(error.getResponse());
      }
    }
    return {
      type: quote.type,
      amount: quote.amount,
      effectiveAt: quote.effectiveAt.toISOString(),
      remainingDays: quote.remainingDays,
      cycleDays: quote.cycleDays,
      guardSelectionRequired: required,
    };
  }

  async change(companyId: string, adminId: string, input: PlanChangeRequest) {
    // The remote amount is changed inside the transaction on purpose: if Mercado Pago refuses, the
    // database keeps the current plan. A failure after the PUT leaves a drift that the daily pass repairs.
    const db = this.prisma.tenantPrisma;
    const result = await db.$transaction(
      async (tx) => {
        // Same Company lock used by guard creations/reactivations; quotes are revalidated under it.
        await tx.company.update({ where: { id: companyId }, data: { id: companyId } });
        const q = await this.quote(
          tx as unknown as Prisma.TransactionClient,
          companyId,
          input.planId,
        );
        const { subscription: s, plan } = q;
        const history = {
          companyId,
          subscriptionId: s.id,
          planId: plan.id,
          adminId,
          effectiveAt: q.effectiveAt,
        };
        if (q.type === 'downgrade_cancelled') {
          await this.mercadoPago.updatePreapprovalAmount(
            s.mpPreapprovalId,
            plan.monthlyPrice.toFixed(2),
          );
          await tx.subscription.update({
            where: { id: s.id },
            data: {
              pendingPlanId: null,
              pendingPlanAt: null,
              pendingGuardSelection: Prisma.DbNull,
              pendingPlanAdminId: null,
            },
          });
          await tx.subscriptionChange.create({
            data: {
              ...history,
              type: 'downgrade_scheduled',
              reason: 'Baja pendiente anulada; se conserva el plan vigente.',
            },
          });
        } else if (q.inTrial || q.type === 'downgrade' || q.amount === '0.00') {
          const selected =
            q.type === 'downgrade'
              ? await this.selection.validate(plan.maxGuards, input.guardSelection, adminId)
              : null;
          // The paid cycle stays unchanged; do not persist a downgrade if the remote PUT fails.
          await this.mercadoPago.updatePreapprovalAmount(
            s.mpPreapprovalId,
            plan.monthlyPrice.toFixed(2),
          );
          const immediate = q.inTrial || q.type === 'upgrade';
          await tx.subscription.update({
            where: { id: s.id },
            data: immediate
              ? {
                  planId: plan.id,
                  guardSelection: selected ?? Prisma.DbNull,
                }
              : {
                  pendingPlanId: plan.id,
                  pendingPlanAt: q.effectiveAt,
                  pendingGuardSelection: selected ?? Prisma.DbNull,
                  pendingPlanAdminId: adminId,
                },
          });
          await tx.subscriptionChange.create({
            data: {
              ...history,
              type: immediate
                ? q.type === 'upgrade'
                  ? 'upgrade'
                  : 'downgrade_applied'
                : 'downgrade_scheduled',
            },
          });
        } else {
          const payment = await tx.planChangePayment.create({
            data: {
              companyId,
              subscriptionId: s.id,
              previousPlanId: s.planId,
              newPlanId: plan.id,
              adminId,
              amount: q.amount,
              remainingDays: q.remainingDays,
              cycleDays: q.cycleDays,
              expiresAt: new Date(
                Math.min(this.clock.now().getTime() + 86_400_000, q.cycleEndsAt.getTime()),
              ),
            },
          });
          // Row commits before checkout: a webhook cannot see an uncommitted payment.
          return {
            effectiveAt: q.effectiveAt.toISOString(),
            payment,
            title: `Garita - diferencia ${plan.name}`,
          };
        }
        return { effectiveAt: q.effectiveAt.toISOString(), payment: null, title: '' };
      },
      { timeout: 120_000 },
    );
    if (!result.payment) return { initPoint: null, effectiveAt: result.effectiveAt };
    try {
      const preference = await this.mercadoPago.createPreference({
        externalReference: `plan-change:${result.payment.id}`,
        title: result.title,
        amount: result.payment.amount.toFixed(2),
        backUrl: `${this.config.get('WEB_APP_URL', { infer: true })}/suscripcion`,
        expiresAt: result.payment.expiresAt,
        excludeOffline: true,
      });
      await db.planChangePayment.update({
        where: { id: result.payment.id },
        data: { mpPreferenceId: preference.id },
      });
      return { initPoint: preference.initPoint, effectiveAt: result.effectiveAt };
    } catch (error) {
      await db.planChangePayment.updateMany({
        where: { id: result.payment.id, status: 'pending' },
        data: {
          status: 'rejected',
          rejectionReason: 'No se pudo crear el enlace de pago.',
        },
      });
      throw error;
    }
  }

  async onPayment(payment: MercadoPagoPayment): Promise<void> {
    const id = payment.external_reference?.slice('plan-change:'.length);
    if (!id) return;
    // Verified payment fetched by the existing webhook, not a user-supplied body; platform lookup.
    this.logger.log({
      event: 'subscription.plan_payment',
      paymentId: payment.id,
      planChangePaymentId: id,
    });
    const root = this.prisma.systemPrisma;
    const stored = await root.planChangePayment.findUnique({ where: { id } });
    if (!stored) throw new NotFoundException('Pago de cambio de plan desconocido');
    await root.$transaction(async (tx) => {
      await tx.company.update({ where: { id: stored.companyId }, data: { id: stored.companyId } });
      const row = await tx.planChangePayment.findUniqueOrThrow({ where: { id } });
      if (row.status === 'approved') return;
      if (!row.amount.equals(new Prisma.Decimal(payment.transaction_amount)))
        throw new ConflictException('El importe del pago no coincide con la diferencia.');
      if (payment.status !== 'approved') {
        if (row.status === 'pending' && ['rejected', 'cancelled'].includes(payment.status))
          await tx.planChangePayment.update({
            where: { id },
            data: {
              status: 'rejected',
              mpPaymentId: payment.id,
              rejectionReason: payment.status_detail ?? 'Pago rechazado',
            },
          });
        return;
      }
      const s = await tx.subscription.findUniqueOrThrow({ where: { id: row.subscriptionId } });
      if (
        s.planId !== row.previousPlanId ||
        s.status !== 'authorized' ||
        s.cancelAt ||
        s.pendingPlanId
      )
        return this.paidWithoutChange(
          tx,
          row,
          payment,
          'La suscripción cambió desde la simulación: reintegrar el pago.',
        );
      if (
        row.status === 'rejected' &&
        (await tx.planChangePayment.count({
          where: {
            subscriptionId: s.id,
            id: { not: row.id },
            status: { in: ['pending', 'approved'] },
            createdAt: { gt: row.createdAt },
          },
        }))
      )
        return this.paidWithoutChange(
          tx,
          row,
          payment,
          'Pago tardío con otro cambio en curso: reintegrar el pago.',
        );
      await tx.subscription.update({ where: { id: s.id }, data: { planId: row.newPlanId } });
      await tx.planChangePayment.update({
        where: { id },
        data: {
          status: 'approved',
          mpPaymentId: payment.id,
          rejectionReason: null,
          amountUpdatePending: true,
        },
      });
      await tx.subscriptionChange.create({
        data: {
          companyId: row.companyId,
          subscriptionId: s.id,
          type: 'upgrade',
          planId: row.newPlanId,
          adminId: row.adminId,
          effectiveAt: this.clock.now(),
        },
      });
    });
    // Apply the limit at commit, then change the debit; retry is durable and independent of webhook delivery.
    await this.repairAmount(stored.subscriptionId, false).catch((error: unknown) => {
      this.logger.error({
        event: 'subscription.amount_update_pending',
        subscriptionId: stored.subscriptionId,
        error: String(error),
      });
    });
  }

  /** The customer paid but the plan cannot change: keep the payment id for the refund and stop the retries. */
  private async paidWithoutChange(
    tx: Prisma.TransactionClient,
    row: { id: string; companyId: string },
    payment: MercadoPagoPayment,
    reason: string,
  ): Promise<void> {
    await tx.planChangePayment.update({
      where: { id: row.id },
      data: { mpPaymentId: payment.id, rejectionReason: reason },
    });
    this.logger.error({
      event: 'subscription.plan_payment_needs_refund',
      companyId: row.companyId,
      planChangePaymentId: row.id,
      paymentId: payment.id,
      reason,
    });
  }

  async repairAmount(subscriptionId: string, compare: boolean): Promise<void> {
    const root = this.prisma.systemPrisma;
    // Everything that can end without a change is checked before taking the Company lock, and
    // the remote read never runs while holding it.
    const initial = await root.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true, pendingPlan: true },
    });
    if (!initial?.mpPreapprovalId || initial.status === 'cancelled') return;
    if (await root.planChangePayment.count({ where: { subscriptionId, status: 'pending' } }))
      return;
    if (
      !compare &&
      !(await root.planChangePayment.count({
        where: { subscriptionId, amountUpdatePending: true },
      }))
    )
      return;
    const before = compare
      ? (await this.mercadoPago.getPreapproval(initial.mpPreapprovalId)).auto_recurring
          ?.transaction_amount
      : null;
    if (compare) {
      if (before === null || before === undefined) {
        this.logger.warn({ event: 'subscription.amount_unavailable', subscriptionId });
        return;
      }
      if ((initial.pendingPlan ?? initial.plan).monthlyPrice.equals(new Prisma.Decimal(before)))
        return;
    }
    await root.$transaction(
      async (tx) => {
        await tx.company.update({
          where: { id: initial.companyId },
          data: { id: initial.companyId },
        });
        const s = await tx.subscription.findUniqueOrThrow({
          where: { id: subscriptionId },
          include: { plan: true, pendingPlan: true },
        });
        if (!s.mpPreapprovalId || s.status === 'cancelled') return;
        if (await tx.planChangePayment.count({ where: { subscriptionId, status: 'pending' } }))
          return;
        const expected = (s.pendingPlan ?? s.plan).monthlyPrice;
        if (
          !compare ||
          (before !== null && before !== undefined && !expected.equals(new Prisma.Decimal(before)))
        ) {
          await this.mercadoPago.updatePreapprovalAmount(s.mpPreapprovalId, expected.toFixed(2));
          if (compare)
            this.logger.error({
              event: 'subscription.amount_diff',
              subscriptionId,
              before: String(before),
              corrected: expected.toFixed(2),
            });
        }
        await tx.planChangePayment.updateMany({
          where: { subscriptionId, amountUpdatePending: true },
          data: { amountUpdatePending: false },
        });
      },
      { timeout: 120_000 },
    );
  }

  async applyDowngrade(subscriptionId: string): Promise<void> {
    const root = this.prisma.systemPrisma;
    // No Company lock unless there is a downgrade to apply.
    const initial = await root.subscription.findUnique({ where: { id: subscriptionId } });
    if (
      !initial?.pendingPlanId ||
      !initial.pendingPlanAt ||
      initial.pendingPlanAt > this.clock.now() ||
      initial.status !== 'authorized' ||
      initial.cancelAt
    )
      return;
    const result = await root.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: initial.companyId },
        data: { id: initial.companyId },
      });
      const s = await tx.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
      if (
        !s.pendingPlanId ||
        !s.pendingPlanAt ||
        s.pendingPlanAt > this.clock.now() ||
        s.status !== 'authorized' ||
        s.cancelAt
      )
        return null;
      if (!s.pendingPlanAdminId)
        throw new ConflictException('Falta el administrador de la baja pendiente.');
      await tx.subscription.update({
        where: { id: s.id },
        data: {
          planId: s.pendingPlanId,
          guardSelection: s.pendingGuardSelection ?? Prisma.DbNull,
          pendingPlanId: null,
          pendingPlanAt: null,
          pendingGuardSelection: Prisma.DbNull,
          pendingPlanAdminId: null,
        },
      });
      await tx.subscriptionChange.create({
        data: {
          companyId: s.companyId,
          subscriptionId: s.id,
          type: 'downgrade_applied',
          planId: s.pendingPlanId,
          effectiveAt: s.pendingPlanAt,
          adminId: s.pendingPlanAdminId,
        },
      });
      return s;
    });
    if (result)
      await this.selection.apply(result.id, result.companyId, result.pendingGuardSelection);
  }

  async history() {
    const db = this.prisma.tenantPrisma;
    const s = await db.subscription.findFirst({
      orderBy: { createdAt: 'desc' },
      include: { pendingPlan: true },
    });
    const [changes, payments] = await Promise.all([
      db.subscriptionChange.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
        include: {
          admin: { select: { firstName: true, lastName: true } },
          plan: { select: { name: true } },
        },
      }),
      db.planChangePayment.findMany({ orderBy: { createdAt: 'desc' }, take: 24 }),
    ]);
    return {
      pendingPlan: s?.pendingPlan
        ? {
            id: s.pendingPlan.id,
            name: s.pendingPlan.name,
            maxGuards: s.pendingPlan.maxGuards,
            monthlyPrice: s.pendingPlan.monthlyPrice.toFixed(2),
          }
        : null,
      pendingEffectiveAt: s?.pendingPlanAt?.toISOString() ?? null,
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount.toFixed(2),
        status: p.status,
        rejectionReason: p.rejectionReason,
        expiresAt: p.expiresAt.toISOString(),
        amountUpdatePending: p.amountUpdatePending,
      })),
      changes: changes.map((c) => ({
        id: c.id,
        type: c.type,
        planName: c.plan.name,
        effectiveAt: c.effectiveAt.toISOString(),
        createdAt: c.createdAt.toISOString(),
        adminName: `${c.admin.firstName} ${c.admin.lastName}`,
        reason: c.reason,
      })),
    };
  }

  async clearDowngrade(
    s: Subscription,
    db: Prisma.TransactionClient = this.prisma.tenantPrisma as unknown as Prisma.TransactionClient,
  ): Promise<void> {
    if (!s.pendingPlanId) return;
    if (!s.mpPreapprovalId) throw new ConflictException('Falta la suscripción en Mercado Pago.');
    const plan = await db.plan.findUniqueOrThrow({ where: { id: s.planId } });
    await this.mercadoPago.updatePreapprovalAmount(s.mpPreapprovalId, plan.monthlyPrice.toFixed(2));
    await db.subscription.update({
      where: { id: s.id },
      data: {
        pendingPlanId: null,
        pendingPlanAt: null,
        pendingGuardSelection: Prisma.DbNull,
        pendingPlanAdminId: null,
      },
    });
  }
}
