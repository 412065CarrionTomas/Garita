import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ACCOUNT_SUSPENDED_CODE,
  GUARD_LIMIT_REACHED_CODE,
  USER_STATUSES,
  accountStateResponseSchema,
  countsTowardGuardLimit,
  daysLeft,
  effectiveGuardLimit,
  trialEndsAt,
  type AccountStateResponse,
} from '@garita/shared';
import type { Prisma } from '../../generated/prisma/client';
import { CLOCK, type Clock } from '../../common/clock';
import type { AccountStatePort } from '../../common/ports/account-state.port';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AccountService implements AccountStatePort {
  private readonly logger = new Logger(AccountService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async lock(companyId: string, tx: Prisma.TransactionClient): Promise<void> {
    // La escritura del mismo id bloquea la fila hasta commit sin cambiar valores de negocio.
    await tx.company.update({ where: { id: companyId }, data: { id: companyId } });
  }

  private async read(companyId: string, db: Prisma.TransactionClient) {
    const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
    const subscription = await db.subscription.findFirst({
      where: { companyId, status: 'authorized' },
      include: { plan: true },
    });
    const basic = await db.plan.findFirstOrThrow({
      where: { active: true },
      orderBy: { maxGuards: 'asc' },
    });
    const guardsCounted = await db.user.count({
      where: {
        companyId,
        role: 'guard',
        status: { in: USER_STATUSES.filter(countsTowardGuardLimit) },
      },
    });
    // HU-42 completa el plan pendiente en este único punto.
    const pendingPlanMaxGuards = subscription?.pendingPlanId
      ? (await db.plan.findUniqueOrThrow({ where: { id: subscription.pendingPlanId } })).maxGuards
      : null;
    const guardLimit = effectiveGuardLimit({
      planMaxGuards: subscription?.plan.maxGuards ?? null,
      pendingPlanMaxGuards,
      basicPlanMaxGuards: basic.maxGuards,
    });
    return { company, guardLimit, guardsCounted };
  }

  async get(companyId: string) {
    // El puerto también se usa desde jobs sin contexto HTTP; cada consulta queda acotada por empresa.
    this.logger.debug({ event: 'account.get', companyId });
    const { company, guardLimit } = await this.read(companyId, this.prisma.systemPrisma);
    return {
      status: company.accountStatus,
      suspensionReason: company.suspensionReason,
      trialEndsAt: company.trialEndsAt,
      graceEndsAt: company.graceEndsAt,
      guardLimit,
    };
  }

  async response(companyId: string): Promise<AccountStateResponse> {
    const { company, guardLimit, guardsCounted } = await this.read(
      companyId,
      this.prisma.tenantPrisma as unknown as Prisma.TransactionClient,
    );
    const now = this.clock.now();
    return accountStateResponseSchema.parse({
      status: company.accountStatus,
      suspensionReason: company.suspensionReason,
      trialEndsAt: company.trialEndsAt?.toISOString() ?? null,
      trialDaysLeft: company.trialEndsAt
        ? daysLeft(company.trialEndsAt, now, company.timezone)
        : null,
      graceEndsAt: company.graceEndsAt?.toISOString() ?? null,
      graceDaysLeft: company.graceEndsAt
        ? daysLeft(company.graceEndsAt, now, company.timezone)
        : null,
      amountDue:
        company.accountStatus === 'grace' && company.graceChargeId
          ? ((
              await this.prisma.tenantPrisma.subscriptionCharge.findUnique({
                where: { id: company.graceChargeId },
              })
            )?.amount.toFixed(2) ?? null)
          : null,
      guardLimit,
      guardsCounted,
    });
  }

  async assertGuardSlot(companyId: string, tx?: Prisma.TransactionClient): Promise<void> {
    if (!tx) {
      // Uso de sistema del puerto fuera de HTTP; la transacción sigue acotada por empresa.
      this.logger.debug({ event: 'account.guard_slot', companyId });
      return this.prisma.systemPrisma.$transaction((db) => this.assertGuardSlot(companyId, db));
    }
    await this.lock(companyId, tx);
    const { company, guardLimit, guardsCounted } = await this.read(companyId, tx);
    if (company.accountStatus === 'suspended')
      throw new ConflictException({
        code: ACCOUNT_SUSPENDED_CODE,
        message: 'La cuenta de tu empresa está suspendida.',
      });
    if (guardsCounted >= guardLimit)
      throw new ConflictException({
        code: GUARD_LIMIT_REACHED_CODE,
        message: `Alcanzaste el límite de vigiladores de ${company.accountStatus === 'trial' ? 'la prueba' : 'tu plan'}.`,
        status: company.accountStatus,
        guardLimit,
        guardsCounted,
      });
  }

  async startTrial(companyId: string): Promise<void> {
    // Puesta en marcha de sistema, sin sesión; nunca reinicia una prueba existente.
    this.logger.log({ event: 'account.start_trial', companyId });
    await this.prisma.systemPrisma.$transaction(async (tx) => {
      await this.lock(companyId, tx);
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      if (company.trialEndsAt || company.accountStatus !== 'trial')
        throw new ConflictException('La empresa ya utilizó su período de prueba.');
      await tx.company.update({
        where: { id: companyId },
        data: { trialEndsAt: trialEndsAt(company.createdAt, company.timezone) },
      });
    });
  }

  async transition(input: Parameters<AccountStatePort['transition']>[0]): Promise<void> {
    // Transición del puerto invocada por jobs/webhooks sin contexto HTTP, siempre por empresa.
    const changed = await this.prisma.systemPrisma.$transaction(async (tx) => {
      await this.lock(input.companyId, tx);
      const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId } });
      return this.change(tx, company, input);
    });
    this.logger.log({
      event: 'account.transition',
      companyId: input.companyId,
      from: changed,
      to: input.to,
      reason: input.reason ?? null,
    });
  }

  private async change(
    tx: Prisma.TransactionClient,
    company: { id: string; accountStatus: string },
    input: Parameters<AccountStatePort['transition']>[0],
  ) {
    const from = company.accountStatus;
    if (from === input.to) return from;
    const valid =
      input.to === 'active'
        ? ['trial', 'grace', 'suspended'].includes(from) && !input.reason && !input.graceEndsAt
        : input.to === 'grace'
          ? from === 'active' &&
            !!input.graceEndsAt &&
            Number.isFinite(input.graceEndsAt.getTime()) &&
            !input.reason
          : input.to === 'suspended' &&
            !input.graceEndsAt &&
            ((from === 'trial' && input.reason === 'trial_expired') ||
              (from === 'active' && input.reason === 'cancelled') ||
              (from === 'grace' && input.reason === 'grace_expired'));
    if (!valid) {
      this.logger.error({
        event: 'account.transition.invalid',
        companyId: company.id,
        from,
        to: input.to,
        reason: input.reason,
      });
      throw new BadRequestException('Transición de cuenta inválida.');
    }
    await tx.company.update({
      where: { id: company.id },
      data: {
        accountStatus: input.to,
        suspensionReason: input.to === 'suspended' ? input.reason : null,
        graceEndsAt: input.to === 'grace' ? input.graceEndsAt : null,
        suspendedAt: input.to === 'suspended' ? this.clock.now() : null,
      },
    });
    return from;
  }

  async finishTrial(companyId: string): Promise<void> {
    // Barrido de sistema; revalida vencimiento, estado y suscripción bajo el mismo bloqueo.
    await this.prisma.systemPrisma.$transaction(async (tx) => {
      await this.lock(companyId, tx);
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      if (
        company.accountStatus !== 'trial' ||
        !company.trialEndsAt ||
        company.trialEndsAt > this.clock.now()
      )
        return;
      const authorized = await tx.subscription.count({
        where: { companyId, status: 'authorized' },
      });
      const to = authorized ? 'active' : 'suspended';
      await this.change(tx, company, {
        companyId,
        to,
        ...(authorized ? {} : { reason: 'trial_expired' }),
      });
      this.logger.log({
        event: 'account.transition',
        companyId,
        from: 'trial',
        to,
        reason: authorized ? null : 'trial_expired',
      });
    });
  }
}
