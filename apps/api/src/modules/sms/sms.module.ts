import { Module } from '@nestjs/common';
import { ClockModule } from '../../common/clock';
import { PrismaModule } from '../prisma/prisma.module';
import { PanicModule } from '../panic/panic.module';
import { SmsInboundService } from './sms-inbound.service';
import { SmsRateLimit } from './sms-rate-limit';
import { SmsInboundController, SmsWebhookController } from './sms.controller';

@Module({
  imports: [ClockModule, PrismaModule, PanicModule],
  controllers: [SmsInboundController, SmsWebhookController],
  providers: [SmsInboundService, SmsRateLimit],
})
export class SmsModule {}
