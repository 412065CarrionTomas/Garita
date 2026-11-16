import { ConflictException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma, type SubscriptionCharge } from '../../generated/prisma/client';
import type { Env } from '../../config/env';
import type { AccountStatePort } from '../../common/ports/account-state.port';
import type { PrismaService } from '../prisma/prisma.service';
import type { ResendInvitationMailer } from '../users/email.service';
import type { MercadoPagoClient, MercadoPagoPayment } from './mercadopago.client';
import { GraceService } from './grace.service';

function fixture(status = 'active') {
  let now = new Date('2030-12-01T15:00:00Z');
  const company = {
    id: 'company',
    accountStatus: status,
    graceChargeId: null as string | null,
    graceEndsAt: null as Date | null,
    graceRemindersSent: [] as number[],
    timezone: 'America/Argentina/Buenos_Aires',
  };
  const charge = {
    id: 'charge',
    companyId: 'company',
    subscriptionId: 'sub',
    status: 'rejected',
    mpAuthorizedPaymentId: 'invoice',
    amount: new Prisma.Decimal('45000.00'),
    gracePaidPaymentId: null as string | null,
    gracePreferenceId: null as string | null,
    graceInitPoint: null as string | null,
    gracePreferenceExpiresAt: null as Date | null,
    mpPaymentId: 'debit',
  };
  const db = {
    company: {
      findUniqueOrThrow: jest.fn().mockImplementation(() => Promise.resolve(company)),
      findMany: jest.fn().mockResolvedValue([company]),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const { graceRemindersSent, ...rest } = data;
        Object.assign(company, rest);
        if (Array.isArray(graceRemindersSent))
          company.graceRemindersSent = graceRemindersSent as number[];
        else if (graceRemindersSent)
          company.graceRemindersSent.push((graceRemindersSent as { push: number }).push);
        return Promise.resolve(company);
      }),
    },
    subscriptionCharge: {
      findUniqueOrThrow: jest.fn().mockImplementation(() => Promise.resolve(charge)),
      findFirstOrThrow: jest.fn().mockImplementation(() => Promise.resolve(charge)),
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(charge)),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve(Object.assign(charge, data)),
        ),
    },
    subscription: { findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'authorized' }) },
    user: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'admin', firstName: 'Ana', email: 'ana@example.invalid' }]),
    },
    $executeRaw: jest.fn(),
  };
  const prisma = {
    tenantPrisma: db,
    systemPrisma: {
      ...db,
      $transaction: async (run: (tx: typeof db) => Promise<unknown>) => run(db),
    },
  };
  const account = {
    get: jest.fn().mockImplementation(() => Promise.resolve({ status: company.accountStatus })),
    transition: jest.fn().mockImplementation((input: { to: string; graceEndsAt?: Date }) => {
      company.accountStatus = input.to;
      company.graceEndsAt = input.graceEndsAt ?? null;
      return Promise.resolve();
    }),
  };
  const mailer = { sendGraceReminder: jest.fn().mockResolvedValue({ id: 'mail' }) };
  const mp = {
    getAuthorizedPayment: jest.fn().mockResolvedValue({
      id: 'invoice',
      preapproval_id: 'mp',
      transaction_amount: '45000.00',
      payment: { status: 'rejected' },
    }),
    searchGracePayments: jest.fn().mockResolvedValue([]),
    createPreference: jest.fn().mockResolvedValue({ id: 'pref', initPoint: 'https://mp.test/pay' }),
    expirePreference: jest.fn().mockResolvedValue(undefined),
  };
  const service = new GraceService(
    prisma as unknown as PrismaService,
    account as unknown as AccountStatePort,
    mailer as unknown as ResendInvitationMailer,
    mp as unknown as MercadoPagoClient,
    { get: () => 'https://web.test' } as unknown as ConfigService<Env, true>,
    { now: () => now },
  );
  const reject = () => service.rejected(charge as unknown as SubscriptionCharge);
  const approve = () => service.approved(charge as unknown as SubscriptionCharge);
  const payment: MercadoPagoPayment = {
    id: 'one-time',
    external_reference: 'grace:charge',
    status: 'approved',
    transaction_amount: '45000.00',
    currency_id: 'ARS',
  };
  return {
    service,
    company,
    charge,
    db,
    account,
    mailer,
    mp,
    payment,
    reject,
    approve,
    setNow: (date: string) => {
      now = new Date(date);
    },
  };
}

describe('HU-30 gracia', () => {
  it('CA1/CA2: 1/12 hasta 8/12 a las 23:59 locales; repetición y segundo rechazo no reinician', async () => {
    const f = fixture();
    await f.reject();
    expect(f.company.graceEndsAt?.toISOString()).toBe('2030-12-09T02:59:00.000Z');
    await f.reject();
    f.charge.id = 'second';
    await f.reject();
    expect(f.account.transition).toHaveBeenCalledTimes(1);
    expect(f.mailer.sendGraceReminder).toHaveBeenCalledTimes(1);
    expect(f.mailer.sendGraceReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '45000.00',
        endsAt: new Date('2030-12-09T02:59:00Z'),
        daysLeft: 0,
      }),
    );
  });
  it.each(['trial', 'suspended'])('no modifica %s ante un rechazo', async (state) => {
    const f = fixture(state);
    await f.reject();
    expect(f.account.transition).not.toHaveBeenCalled();
    expect(f.mailer.sendGraceReminder).not.toHaveBeenCalled();
  });
  it('CA2: 3 días y último día se envían una sola vez a administradores activos', async () => {
    const f = fixture();
    await f.reject();
    for (const date of ['2030-12-06T15:00:00Z', '2030-12-08T15:00:00Z']) {
      f.setNow(date);
      await f.service.sweep();
      await f.service.sweep();
    }
    expect(
      f.mailer.sendGraceReminder.mock.calls.map(
        ([input]: [{ daysLeft: number }]) => input.daysLeft,
      ),
    ).toEqual([0, 3, 1]);
    expect(f.db.user.findMany).toHaveBeenCalledWith({
      where: { companyId: 'company', role: 'admin', status: 'active' },
    });
  });
  it('CA3: aprobación automática limpia la gracia; una entrega repetida no activa dos veces', async () => {
    const f = fixture();
    await f.reject();
    f.charge.status = 'approved';
    await f.approve();
    await f.approve();
    expect(f.company.accountStatus).toBe('active');
    expect(f.company.graceRemindersSent).toEqual([]);
    expect(f.account.transition).toHaveBeenCalledTimes(2);
  });
  it('CA4: no vence antes de las 23:59 y vence con grace_expired', async () => {
    const f = fixture();
    await f.reject();
    f.setNow('2030-12-09T02:58:59Z');
    await f.service.sweep();
    expect(f.company.accountStatus).toBe('grace');
    f.setNow('2030-12-09T02:59:00Z');
    await f.service.sweep();
    expect(f.account.transition).toHaveBeenLastCalledWith({
      companyId: 'company',
      to: 'suspended',
      reason: 'grace_expired',
    });
    expect(f.company.graceRemindersSent).toEqual([]);
  });
  it('reutiliza enlace sin pago iniciado, vence en 24 horas y consulta el estado remoto', async () => {
    const f = fixture();
    await f.reject();
    const first = await f.service.retry('company');
    expect(first.expiresAt).toBe('2030-12-02T15:00:00.000Z');
    expect(await f.service.retry('company')).toEqual(first);
    expect(f.mp.createPreference).toHaveBeenCalledTimes(1);
    expect(f.mp.getAuthorizedPayment).toHaveBeenCalledTimes(2);
  });
  it('limita preferencia al fin de gracia y no reintenta después', async () => {
    const f = fixture();
    await f.reject();
    f.setNow('2030-12-08T23:00:00Z');
    expect((await f.service.retry('company')).expiresAt).toBe('2030-12-09T02:59:00.000Z');
    f.setNow('2030-12-09T03:00:00Z');
    await expect(f.service.retry('company')).rejects.toBeInstanceOf(ConflictException);
  });
  it.each(['pending', 'in_process', 'authorized'])(
    '409 con débito remoto %s aunque lo guardado diga rechazado',
    async (status) => {
      const f = fixture();
      await f.reject();
      f.mp.getAuthorizedPayment.mockResolvedValue({ payment: { status } });
      await expect(f.service.retry('company')).rejects.toBeInstanceOf(ConflictException);
      expect(f.mp.createPreference).not.toHaveBeenCalled();
    },
  );
  it('409 con pago único pendiente y ante resultado desconocido de creación', async () => {
    const f = fixture();
    await f.reject();
    f.mp.searchGracePayments.mockResolvedValueOnce([{ status: 'pending' }]);
    await expect(f.service.retry('company')).rejects.toThrow('pendiente');
    f.mp.createPreference.mockRejectedValueOnce(new Error('timeout'));
    await expect(f.service.retry('company')).rejects.toThrow('timeout');
    await expect(f.service.retry('company')).rejects.toThrow('confirmando');
    expect(f.mp.createPreference).toHaveBeenCalledTimes(1);
  });
  it('pago único aprobado es idempotente; pago rechazado no modifica la cuenta', async () => {
    const f = fixture();
    await f.reject();
    await f.service.retry('company');
    await f.service.oneTimePayment({ ...f.payment, status: 'rejected' });
    expect(f.company.accountStatus).toBe('grace');
    await f.service.oneTimePayment(f.payment);
    await f.service.oneTimePayment(f.payment);
    expect(f.company.accountStatus).toBe('active');
    expect(f.charge.gracePaidPaymentId).toBe('one-time');
    expect(f.account.transition).toHaveBeenCalledTimes(2);
  });
  it.each(['automatic-first', 'one-time-first'])(
    'doble cobro %s registra ambos ids sin otra transición',
    async (order) => {
      const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      try {
        const f = fixture();
        await f.reject();
        await f.service.retry('company');
        if (order === 'automatic-first') {
          f.charge.status = 'approved';
          await f.approve();
          await f.service.oneTimePayment(f.payment);
        } else {
          await f.service.oneTimePayment(f.payment);
          f.charge.status = 'approved';
          await f.approve();
        }
        expect(log).toHaveBeenCalledWith(
          expect.objectContaining({
            event: 'subscription.double_charge',
            companyId: 'company',
            chargeId: 'charge',
            debitPaymentId: 'debit',
            oneTimePaymentId: 'one-time',
          }),
        );
        expect(f.account.transition).toHaveBeenCalledTimes(2);
      } finally {
        log.mockRestore();
      }
    },
  );
  it.each([{ transaction_amount: '1.00' }, { currency_id: 'USD' }])(
    'rechaza monto o moneda distintos',
    async (invalid) => {
      const f = fixture();
      await f.reject();
      await f.service.retry('company');
      await expect(f.service.oneTimePayment({ ...f.payment, ...invalid })).rejects.toThrow(
        'monto o moneda',
      );
      expect(f.company.accountStatus).toBe('grace');
    },
  );
  it('correo fallido se reintenta sin reiniciar la gracia y el barrido propaga el error', async () => {
    const f = fixture();
    f.mailer.sendGraceReminder.mockRejectedValueOnce(new Error('mail'));
    await expect(f.reject()).rejects.toThrow('mail');
    const end = f.company.graceEndsAt;
    await f.reject();
    expect(f.company.graceEndsAt).toBe(end);
    expect(f.company.graceRemindersSent).toEqual([0]);
    f.setNow('2030-12-06T15:00:00Z');
    f.mailer.sendGraceReminder.mockRejectedValueOnce(new Error('mail'));
    await expect(f.service.sweep()).rejects.toThrow('barrido');
    await f.service.sweep();
    expect(f.company.graceRemindersSent).toEqual([0, 3]);
  });
});
