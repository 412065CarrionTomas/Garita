import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  daysLeft,
  graceEndsAt,
  GRACE_REMINDER_DAYS,
  type GraceRetryResponse,
} from '@garita/shared';
import { CLOCK, type Clock } from '../../common/clock';
import { ACCOUNT_STATE_PORT, type AccountStatePort } from '../../common/ports/account-state.port';
import type { Env } from '../../config/env';
import { Prisma, type SubscriptionCharge } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ResendInvitationMailer } from '../users/email.service';
import { MercadoPagoClient, type MercadoPagoPayment } from './mercadopago.client';

// shortcut: portal general sin enlace por suscripción; actualizar si MP documenta uno.
// Fuente: https://www.mercadopago.com.ar/developers/es/docs/subscriptions/subscription-management
export const MP_SUBSCRIPTIONS_PORTAL = 'https://www.mercadopago.com.ar/subscriptions';

@Injectable()
export class GraceService {
  private readonly logger = new Logger(GraceService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACCOUNT_STATE_PORT) private readonly account: AccountStatePort,
    private readonly mailer: ResendInvitationMailer,
    private readonly mercadoPago: MercadoPagoClient,
    private readonly config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async locked<T>(companyId: string, run: () => Promise<T>): Promise<T> {
    // Webhooks y barridos no tienen tenant HTTP. El lock solo coordina gracia; no bloquea Company.
    this.logger.debug({ event: 'subscription.grace.system_query', companyId });
    return this.prisma.systemPrisma.$transaction(
      async (tx) => {
        const key = `subscription-grace:${companyId}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        return run();
      },
      { timeout: 120_000 },
    );
  }

  async rejected(input: SubscriptionCharge): Promise<void> {
    return this.locked(input.companyId, async () => {
      const db = this.prisma.systemPrisma;
      const charge = await db.subscriptionCharge.findUniqueOrThrow({ where: { id: input.id } });
      const subscription = await db.subscription.findUniqueOrThrow({
        where: { id: charge.subscriptionId },
      });
      const state = await this.account.get(charge.companyId);
      if (
        charge.status !== 'rejected' ||
        charge.gracePaidPaymentId ||
        !['authorized', 'paused'].includes(subscription.status)
      )
        return;
      if (state.status === 'active') {
        await db.company.update({
          where: { id: charge.companyId },
          data: { graceChargeId: charge.id, graceRemindersSent: [] },
        });
        await this.account.transition({
          companyId: charge.companyId,
          to: 'grace',
          graceEndsAt: graceEndsAt(
            this.clock.now(),
            (await db.company.findUniqueOrThrow({ where: { id: charge.companyId } })).timezone,
          ),
        });
      } else {
        this.logger.log({
          event: 'subscription.grace.rejection_ignored',
          companyId: charge.companyId,
          chargeId: charge.id,
          status: state.status,
        });
      }
      const company = await db.company.findUniqueOrThrow({ where: { id: charge.companyId } });
      if (company.accountStatus === 'grace' && company.graceChargeId === charge.id)
        await this.remind(company.id, 0);
    });
  }

  async approved(input: SubscriptionCharge): Promise<void> {
    return this.locked(input.companyId, async () => {
      const charge = await this.prisma.systemPrisma.subscriptionCharge.findUniqueOrThrow({
        where: { id: input.id },
      });
      if (charge.status !== 'approved') return;
      if (charge.gracePaidPaymentId)
        this.doubleCharge(charge, charge.mpPaymentId, charge.gracePaidPaymentId);
      // Also after a one-time payment: whichever approval lands second must still leave the grace.
      await this.activate(charge);
    });
  }

  private doubleCharge(charge: SubscriptionCharge, debitId: string | null, paymentId: string) {
    this.logger.error({
      event: 'subscription.double_charge',
      companyId: charge.companyId,
      chargeId: charge.id,
      debitPaymentId: debitId,
      oneTimePaymentId: paymentId,
    });
  }

  private async activate(charge: SubscriptionCharge): Promise<void> {
    const db = this.prisma.systemPrisma;
    const company = await db.company.findUniqueOrThrow({ where: { id: charge.companyId } });
    if (company.accountStatus !== 'grace' || company.graceChargeId !== charge.id) return;
    await this.account.transition({ companyId: company.id, to: 'active' });
    await db.company.update({
      where: { id: company.id },
      data: { graceRemindersSent: [], graceChargeId: null },
    });
  }

  async oneTimePayment(payment: MercadoPagoPayment): Promise<void> {
    if (payment.status !== 'approved' || !payment.external_reference?.startsWith('grace:')) return;
    // El recurso fue consultado y validado por el webhook, nunca se usa su cuerpo como pago.
    this.logger.debug({ event: 'subscription.grace.payment_system_query', paymentId: payment.id });
    const chargeId = payment.external_reference.slice('grace:'.length);
    const charge = await this.prisma.systemPrisma.subscriptionCharge.findUnique({
      where: { id: chargeId },
    });
    if (!charge) throw new NotFoundException('El cobro de gracia no existe');
    await this.locked(charge.companyId, () => this.applyPayment(chargeId, payment));
  }

  private async applyPayment(chargeId: string, payment: MercadoPagoPayment): Promise<void> {
    const db = this.prisma.systemPrisma;
    const charge = await db.subscriptionCharge.findUniqueOrThrow({ where: { id: chargeId } });
    if (
      !charge.gracePreferenceId ||
      !new Prisma.Decimal(payment.transaction_amount).equals(charge.amount) ||
      payment.currency_id !== 'ARS'
    ) {
      throw new ConflictException('El pago no corresponde al monto o moneda del cobro de gracia');
    }
    if (charge.gracePaidPaymentId === payment.id) {
      if (charge.status !== 'approved') await this.activate(charge);
      return;
    }
    if (charge.gracePaidPaymentId) {
      this.doubleCharge(charge, charge.gracePaidPaymentId, payment.id);
      return;
    }
    await db.subscriptionCharge.update({
      where: { id: charge.id },
      data: { gracePaidPaymentId: payment.id },
    });
    if (charge.status === 'approved') this.doubleCharge(charge, charge.mpPaymentId, payment.id);
    await this.activate(charge);
  }

  async paymentMethod(companyId: string) {
    const subscription = await this.prisma.tenantPrisma.subscription.findFirst({
      where: { status: { in: ['authorized', 'paused'] } },
    });
    if (subscription?.companyId !== companyId)
      throw new NotFoundException('No hay una suscripción abierta');
    return { url: MP_SUBSCRIPTIONS_PORTAL };
  }

  async retry(companyId: string): Promise<GraceRetryResponse> {
    // Solo se acepta la empresa autenticada; no hay ids de cobro elegidos por el cliente.
    await this.prisma.tenantPrisma.company.findUniqueOrThrow({ where: { id: companyId } });
    return this.locked(companyId, async () => {
      const db = this.prisma.systemPrisma;
      const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
      const now = this.clock.now();
      if (
        company.accountStatus !== 'grace' ||
        !company.graceEndsAt ||
        company.graceEndsAt <= now ||
        !company.graceChargeId
      )
        throw new ConflictException('La cuenta no está en un período de gracia vigente');
      const charge = await db.subscriptionCharge.findFirstOrThrow({
        where: { id: company.graceChargeId, companyId },
      });
      const remote = await this.mercadoPago.getAuthorizedPayment(charge.mpAuthorizedPaymentId);
      if (remote.payment?.status === 'approved')
        throw new ConflictException('El cobro ya fue aprobado; actualizá la suscripción');
      if (
        remote.status === 'waiting for gateway' ||
        !['rejected', 'cancelled'].includes(remote.payment?.status ?? '')
      )
        throw new ConflictException(
          'El cobro está en proceso en Mercado Pago. Esperá su resultado.',
        );
      const payments = await this.mercadoPago.searchGracePayments(`grace:${charge.id}`);
      const approved = payments.find((payment) => payment.status === 'approved');
      if (approved) {
        await this.applyPayment(charge.id, approved);
        throw new ConflictException('El pago ya fue aprobado; actualizá la cuenta');
      }
      if (
        payments.some(
          (payment) =>
            ['in_process', 'authorized', 'in_mediation'].includes(payment.status) ||
            (payment.status === 'pending' &&
              (!payment.date_of_expiration || new Date(payment.date_of_expiration) > now)),
        )
      )
        throw new ConflictException(
          'Hay un pago único pendiente en Mercado Pago. Esperá su resultado.',
        );
      if (charge.gracePaidPaymentId) throw new ConflictException('El cobro ya fue regularizado');
      if (charge.gracePreferenceExpiresAt && charge.gracePreferenceExpiresAt > now) {
        if (!charge.gracePreferenceId || !charge.graceInitPoint)
          throw new ConflictException(
            'Se está confirmando la creación del enlace de pago. Contactá al administrador del sistema si persiste.',
          );
        await this.mercadoPago.expirePreference(
          charge.gracePreferenceId,
          charge.gracePreferenceExpiresAt,
        );
        return {
          initPoint: charge.graceInitPoint,
          expiresAt: charge.gracePreferenceExpiresAt.toISOString(),
        };
      }
      const expiresAt = new Date(
        Math.min(now.getTime() + 86_400_000, company.graceEndsAt.getTime()),
      );
      // Una respuesta perdida al crear la preferencia no habilita otra creación a ciegas.
      await db.subscriptionCharge.update({
        where: { id: charge.id },
        data: {
          gracePreferenceExpiresAt: expiresAt,
          gracePreferenceId: null,
          graceInitPoint: null,
        },
      });
      const preference = await this.mercadoPago.createPreference({
        externalReference: `grace:${charge.id}`,
        title: 'Garita: regularizar el ciclo adeudado',
        amount: charge.amount.toFixed(2),
        backUrl: new URL(
          '/suscripcion',
          this.config.get('WEB_APP_URL', { infer: true }),
        ).toString(),
      });
      await db.subscriptionCharge.update({
        where: { id: charge.id },
        data: { gracePreferenceId: preference.id, graceInitPoint: preference.initPoint },
      });
      await this.mercadoPago.expirePreference(preference.id, expiresAt);
      return { initPoint: preference.initPoint, expiresAt: expiresAt.toISOString() };
    });
  }

  private async remind(companyId: string, remaining: number): Promise<void> {
    const db = this.prisma.systemPrisma;
    const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
    if (
      company.accountStatus !== 'grace' ||
      !company.graceEndsAt ||
      !company.graceChargeId ||
      company.graceRemindersSent.includes(remaining)
    )
      return;
    const charge = await db.subscriptionCharge.findUniqueOrThrow({
      where: { id: company.graceChargeId },
    });
    const admins = await db.user.findMany({
      where: { companyId, role: 'admin', status: 'active' },
    });
    for (const admin of admins)
      await this.mailer.sendGraceReminder({
        name: admin.firstName,
        email: admin.email,
        companyId,
        userId: admin.id,
        chargeId: charge.id,
        daysLeft: remaining,
        endsAt: company.graceEndsAt,
        timezone: company.timezone,
        amount: charge.amount.toFixed(2),
      });
    await db.company.update({
      where: { id: companyId },
      data: { graceRemindersSent: { push: remaining } },
    });
    this.logger.log({
      event: 'subscription.grace.reminder',
      companyId,
      chargeId: charge.id,
      daysLeft: remaining,
    });
  }

  async sweep(): Promise<void> {
    // Descubrimiento de sistema desde BullMQ; cada empresa se vuelve a leer bajo su lock.
    this.logger.log({ event: 'subscription.grace.sweep' });
    const db = this.prisma.systemPrisma;
    const companies = await db.company.findMany({ where: { accountStatus: 'grace' } });
    let failed = false;
    for (const candidate of companies) {
      try {
        await this.locked(candidate.id, async () => {
          const company = await db.company.findUniqueOrThrow({ where: { id: candidate.id } });
          if (company.accountStatus !== 'grace' || !company.graceEndsAt || !company.graceChargeId)
            return;
          const charge = await db.subscriptionCharge.findUniqueOrThrow({
            where: { id: company.graceChargeId },
          });
          if (charge.status === 'approved' || charge.gracePaidPaymentId)
            return this.activate(charge);
          const now = this.clock.now();
          if (company.graceEndsAt <= now) {
            await this.account.transition({
              companyId: company.id,
              to: 'suspended',
              reason: 'grace_expired',
            });
            await db.company.update({
              where: { id: company.id },
              data: { graceRemindersSent: [] },
            });
            return;
          }
          await this.remind(company.id, 0);
          const remaining = daysLeft(company.graceEndsAt, now, company.timezone);
          if (GRACE_REMINDER_DAYS.some((day) => day === remaining))
            await this.remind(company.id, remaining);
        });
      } catch (error) {
        failed = true;
        this.logger.error({
          event: 'subscription.grace.failed',
          companyId: candidate.id,
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
    if (failed) throw new Error('Falló el barrido de gracia para una o más empresas');
  }
}
