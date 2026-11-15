import { Inject, Injectable, Logger } from '@nestjs/common';
import { daysLeft, TRIAL_REMINDER_DAYS } from '@garita/shared';
import { CLOCK, type Clock } from '../../common/clock';
import { PrismaService } from '../prisma/prisma.service';
import { ResendInvitationMailer } from '../users/email.service';
import { AccountService } from './account.service';

@Injectable()
export class AccountTrialService {
  private readonly logger = new Logger(AccountTrialService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly account: AccountService,
    private readonly mailer: ResendInvitationMailer,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async sweep(): Promise<void> {
    this.logger.log({ event: 'account.trial.sweep' });
    // Barrido de todas las empresas desde BullMQ, sin contexto HTTP.
    const db = this.prisma.systemPrisma;
    const companies = await db.company.findMany({
      where: { accountStatus: 'trial', trialEndsAt: { not: null } },
    });
    let failed = false;
    for (const company of companies) {
      try {
        if (!company.trialEndsAt) continue;
        const now = this.clock.now();
        if (company.trialEndsAt <= now) {
          await this.account.finishTrial(company.id);
          continue;
        }
        const remaining = daysLeft(company.trialEndsAt, now, company.timezone);
        if (
          !TRIAL_REMINDER_DAYS.some((day) => day === remaining) ||
          company.trialRemindersSent.includes(remaining)
        )
          continue;
        const admins = await db.user.findMany({
          where: { companyId: company.id, role: 'admin', status: 'active' },
        });
        for (const admin of admins) {
          await this.mailer.sendTrialReminder({
            name: admin.firstName,
            email: admin.email,
            daysLeft: remaining,
            companyId: company.id,
            userId: admin.id,
          });
        }
        await db.company.updateMany({
          where: {
            id: company.id,
            accountStatus: 'trial',
            NOT: { trialRemindersSent: { has: remaining } },
          },
          data: { trialRemindersSent: { push: remaining } },
        });
        this.logger.log({
          event: 'account.trial.reminder',
          companyId: company.id,
          daysLeft: remaining,
        });
      } catch (error) {
        failed = true;
        this.logger.error({
          event: 'account.trial.failed',
          companyId: company.id,
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
    if (failed) throw new Error('Falló el barrido de prueba para una o más empresas.');
  }
}
