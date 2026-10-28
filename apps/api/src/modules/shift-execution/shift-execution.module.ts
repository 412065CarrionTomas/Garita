import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { ClockModule } from '../../common/clock';
import { ShiftCredentialModule } from '../sync/shift-credential.module';
import { SupervisionModule } from '../supervision/supervision.module';
import { ShiftExecutionController } from './shift-execution.controller';
import {
  ShiftExecutionService,
  SHIFT_AUTO_CLOSE_QUEUE,
  SYNC_DEADLINE_PORT,
} from './shift-execution.service';
import { PrismaSyncDeadline } from './prisma-sync-deadline';
import { ShiftAutoCloseProcessor } from './shift-auto-close.processor';
import { SHIFT_EXECUTION_EFFECTS_PORT } from './shift-execution-effects.port';
import { ShiftGuardLeaveEffects } from './shift-guard-leave.effects';
import {
  RoundWindowEvaluationProcessor,
  ROUND_WINDOW_EVALUATION_QUEUE,
} from './round-window-evaluation.processor';

@Module({
  imports: [
    PrismaModule,
    ClockModule,
    BullModule.registerQueue({ name: SHIFT_AUTO_CLOSE_QUEUE }),
    BullModule.registerQueue({ name: ROUND_WINDOW_EVALUATION_QUEUE }),
    ShiftCredentialModule,
    SupervisionModule,
  ],
  controllers: [ShiftExecutionController],
  providers: [
    ShiftExecutionService,
    ShiftAutoCloseProcessor,
    RoundWindowEvaluationProcessor,
    { provide: SHIFT_EXECUTION_EFFECTS_PORT, useClass: ShiftGuardLeaveEffects },
    { provide: SYNC_DEADLINE_PORT, useClass: PrismaSyncDeadline },
  ],
  exports: [ShiftExecutionService, SYNC_DEADLINE_PORT],
})
export class ShiftExecutionModule {}
