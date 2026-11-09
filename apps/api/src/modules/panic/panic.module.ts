import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { PanicAttentionController } from './panic-attention.controller';
import { PanicAttentionService } from './panic-attention.service';
import { PanicJobsService, PANIC_SMS_QUEUE, PANIC_ESCALATION_QUEUE } from './panic-jobs.service';
import { PanicSmsProcessor, PanicEscalationProcessor } from './panic.processors';
import { ClockModule } from '../../common/clock';
import { PortsModule } from '../../common/ports/ports.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ShiftCredentialModule } from '../sync/shift-credential.module';
import { PanicController } from './panic.controller';
import { PanicService } from './panic.service';

@Module({
  imports: [
    ClockModule,
    PortsModule,
    PrismaModule,
    ShiftCredentialModule,
    AuthModule,
    BullModule.registerQueue({ name: PANIC_SMS_QUEUE }, { name: PANIC_ESCALATION_QUEUE }),
  ],
  controllers: [PanicController, PanicAttentionController],
  providers: [
    PanicService,
    PanicAttentionService,
    PanicJobsService,
    PanicSmsProcessor,
    PanicEscalationProcessor,
  ],
  exports: [PanicService],
})
export class PanicModule {}
