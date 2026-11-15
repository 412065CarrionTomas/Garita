import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ClockModule } from '../../common/clock';
import { PrismaModule } from '../prisma/prisma.module';
import { ResendInvitationMailer } from '../users/email.service';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { AccountTrialService } from './account-trial.service';
import { AccountTrialProcessor, ACCOUNT_TRIAL_QUEUE } from './account-trial.processor';

@Module({
  imports: [PrismaModule, ClockModule, BullModule.registerQueue({ name: ACCOUNT_TRIAL_QUEUE })],
  controllers: [AccountController],
  providers: [AccountService, AccountTrialService, AccountTrialProcessor, ResendInvitationMailer],
  exports: [AccountService],
})
export class AccountModule {}
