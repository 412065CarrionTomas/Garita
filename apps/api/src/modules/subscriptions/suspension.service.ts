import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK, type Clock } from '../../common/clock';
import { Prisma } from '../../generated/prisma/client';
import { MercadoPagoClient } from './mercadopago.client';
import { GraceService } from './grace.service';
import { GuardSelectionService } from './guard-selection';
import type { PayOverdueRequest } from '@garita/shared';

@Injectable()
export class SuspensionService {
  private readonly logger = new Logger(SuspensionService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly mercadoPago: MercadoPagoClient,
    private readonly grace: GraceService,
    private readonly selection: GuardSelectionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async pay(input: PayOverdueRequest, user: AuthenticatedUser) {
    const db = this.prisma.tenantPrisma;
    const company = await db.company.findUniqueOrThrow({ where: { id: user.companyId } });
    if (
      company.accountStatus !== 'suspended' ||
      company.suspensionReason !== 'grace_expired' ||
      !company.graceChargeId
    )
      throw new ConflictException(
        'No hay un ciclo adeudado para regularizar. Elegí un plan y volvé a suscribirte.',
      );
    if (input.planId) {
      const subscription = await db.subscription.findFirstOrThrow({
        where: { status: { in: ['authorized', 'paused'] }, cancelAt: null },
        include: { plan: true },
      });
      const plan = await db.plan.findFirstOrThrow({ where: { id: input.planId, active: true } });
      if (plan.monthlyPrice.gt(subscription.plan.monthlyPrice))
        throw new ConflictException('Para regularizar elegí tu plan actual o uno menor.');
      const guardSelection = await this.selection.validate(
        plan.maxGuards,
        input.guardSelection,
        user.userId,
      );
      const saved = await db.subscription.updateMany({
        where: {
          id: subscription.id,
          company: {
            accountStatus: 'suspended',
            suspensionReason: 'grace_expired',
            graceChargeId: company.graceChargeId,
          },
        },
        data: {
          suspensionPlanId: plan.id,
          guardSelection: guardSelection ?? Prisma.DbNull,
        },
      });
      if (!saved.count)
        throw new ConflictException('La cuenta ya cambió de estado. Actualizá la suscripción.');
    }
    return this.grace.retry(user.companyId);
  }

  async sweep(): Promise<void> {
    // Durable Company marker is written in the account transaction: no enqueue/commit gap.
    this.logger.debug({ event: 'subscription.suspension.system_sweep' });
    const db = this.prisma.systemPrisma;
    const companies = await db.company.findMany({
      where: { OR: [{ suspensionEffectsPending: true }, { accountStatus: 'suspended' }] },
      select: { id: true },
    });
    let failed = false;
    for (const candidate of companies) {
      try {
        await this.reconcile(candidate.id);
      } catch (error) {
        failed = true;
        this.logger.error({
          event: 'subscription.suspension.failed',
          companyId: candidate.id,
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
    if (failed) throw new Error('No se pudieron aplicar todos los efectos de suspensión');
  }

  async reconcile(companyId: string): Promise<void> {
    // System worker, restricted to one company; the same row lock as AccountService serializes transitions.
    this.logger.debug({ event: 'subscription.suspension.system_query', companyId });
    const result = await this.prisma.systemPrisma.$transaction(
      async (tx) => {
        await tx.company.update({ where: { id: companyId }, data: { id: companyId } });
        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
        const suspended = company.accountStatus === 'suspended';
        if (suspended) {
          await tx.shift.updateMany({
            where: {
              companyId,
              startedAt: null,
              status: { in: ['scheduled', 'unassigned'] },
              startsAt: { lte: this.clock.now() },
              endsAt: { gt: company.suspendedAt ?? this.clock.now() },
            },
            data: { status: 'cancelled_by_suspension' },
          });
          await tx.shiftAssignment.updateMany({
            where: { active: true, shift: { companyId, status: 'cancelled_by_suspension' } },
            data: { active: false },
          });
        }
        const subscription = await tx.subscription.findFirst({
          where: { companyId, status: { in: ['authorized', 'paused'] }, cancelAt: null },
        });
        if (subscription?.mpPreapprovalId && company.suspensionReason !== 'cancelled') {
          if (suspended && !subscription.suspensionPausedAt) {
            const remote = await this.mercadoPago.getPreapproval(subscription.mpPreapprovalId);
            if (remote.status !== 'paused')
              await this.mercadoPago.setPreapprovalStatus(subscription.mpPreapprovalId, 'paused');
            await tx.subscription.update({
              where: { id: subscription.id },
              data: { status: 'paused', suspensionPausedAt: this.clock.now() },
            });
          } else if (
            !suspended &&
            (subscription.suspensionPausedAt || subscription.suspensionPlanId)
          ) {
            if (subscription.suspensionPlanId) {
              const plan = await tx.plan.findUniqueOrThrow({
                where: { id: subscription.suspensionPlanId },
              });
              await this.mercadoPago.updatePreapprovalAmount(
                subscription.mpPreapprovalId,
                plan.monthlyPrice.toFixed(2),
              );
            }
            // Official docs allow reactivation, but do not guarantee preservation of its billing date.
            // https://www.mercadopago.com.ar/developers/es/docs/subscriptions/subscription-management
            const remote = await this.mercadoPago.getPreapproval(subscription.mpPreapprovalId);
            const resumed =
              remote.status === 'authorized'
                ? remote
                : await this.mercadoPago.setPreapprovalStatus(
                    subscription.mpPreapprovalId,
                    'authorized',
                  );
            const expected = subscription.nextChargeAt?.toISOString() ?? null;
            const actual = resumed.next_payment_date ? new Date(resumed.next_payment_date) : null;
            if (!actual || !expected || actual.getTime() !== subscription.nextChargeAt?.getTime())
              this.logger.error({
                event: 'subscription.next_payment_date_diff',
                companyId,
                subscriptionId: subscription.id,
                expected,
                actual: resumed.next_payment_date ?? null,
              });
            await tx.subscription.update({
              where: { id: subscription.id },
              data: {
                status: 'authorized',
                suspensionPausedAt: null,
                suspensionPlanId: null,
                // Después de comparar: la fecha visible es la que cobrará Mercado Pago.
                ...(actual ? { nextChargeAt: actual } : {}),
                ...(subscription.suspensionPlanId ? { planId: subscription.suspensionPlanId } : {}),
              },
            });
            return subscription;
          }
        }
        if (
          !suspended &&
          company.suspensionEffectsPending &&
          subscription?.status === 'authorized' &&
          subscription.guardSelection
        )
          return subscription;
        await tx.company.update({
          where: { id: companyId },
          data: { suspensionEffectsPending: false },
        });
        return null;
      },
      { timeout: 120_000 },
    );
    if (result) {
      await this.selection.apply(result.id, companyId, result.guardSelection);
      await this.prisma.systemPrisma.company.update({
        where: { id: companyId },
        data: { suspensionEffectsPending: false },
      });
    }
  }
}
