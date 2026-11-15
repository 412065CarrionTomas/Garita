import { trialEndsAt } from '@garita/shared';
import { AccountTrialService } from './account-trial.service';

function setup(timezone = 'America/Argentina/Buenos_Aires') {
  const company = {
    id: 'company',
    timezone,
    trialEndsAt: trialEndsAt(new Date('2030-11-01T12:00:00Z'), timezone),
    trialRemindersSent: [] as number[],
  };
  let now = new Date('2030-11-08T12:00:00Z');
  const db = {
    company: {
      findMany: jest.fn().mockResolvedValue([company]),
      updateMany: jest.fn(({ data }: { data: { trialRemindersSent: { push: number } } }) => {
        company.trialRemindersSent.push(data.trialRemindersSent.push);
        return Promise.resolve({ count: 1 });
      }),
    },
    user: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'admin', firstName: 'Ana', email: 'ana@example.invalid' }]),
    },
  };
  const account = { finishTrial: jest.fn().mockResolvedValue(undefined) };
  const mailer = { sendTrialReminder: jest.fn().mockResolvedValue({ id: 'mail' }) };
  const service = new AccountTrialService(
    { systemPrisma: db } as never,
    account as never,
    mailer as never,
    { now: () => now },
  );
  return {
    company,
    db,
    account,
    mailer,
    service,
    setNow: (date: Date) => {
      now = date;
    },
  };
}

describe('AccountTrialService con CLOCK', () => {
  it.each([7, 3, 1])(
    'envía recordatorio con %s días una sola vez, a administradores activos',
    async (remaining) => {
      const f = setup();
      f.setNow(new Date(`2030-11-${String(15 - remaining).padStart(2, '0')}T12:00:00Z`));
      await f.service.sweep();
      await f.service.sweep();
      expect(f.mailer.sendTrialReminder).toHaveBeenCalledTimes(1);
      expect(f.mailer.sendTrialReminder).toHaveBeenCalledWith(
        expect.objectContaining({ daysLeft: remaining }),
      );
      expect(f.db.user.findMany).toHaveBeenCalledWith({
        where: { companyId: 'company', role: 'admin', status: 'active' },
      });
      expect(f.company.trialRemindersSent).toEqual([remaining]);
    },
  );
  it('no marca enviado cuando falla el correo y reintenta', async () => {
    const f = setup();
    f.mailer.sendTrialReminder.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(f.service.sweep()).rejects.toThrow();
    expect(f.company.trialRemindersSent).toEqual([]);
    await f.service.sweep();
    expect(f.company.trialRemindersSent).toEqual([7]);
  });
  it('no manda recordatorios otros días', async () => {
    const f = setup();
    f.setNow(new Date('2030-11-02T12:00:00Z'));
    await f.service.sweep();
    expect(f.mailer.sendTrialReminder).not.toHaveBeenCalled();
  });
  it.each(['America/Argentina/Buenos_Aires', 'Asia/Tokyo', 'America/New_York'])(
    'nunca vence antes de las 23:59 locales en %s',
    async (timezone) => {
      const f = setup(timezone);
      f.setNow(new Date(f.company.trialEndsAt.getTime() - 1));
      await f.service.sweep();
      expect(f.account.finishTrial).not.toHaveBeenCalled();
      f.setNow(f.company.trialEndsAt);
      await f.service.sweep();
      expect(f.account.finishTrial).toHaveBeenCalledWith('company');
    },
  );
});
