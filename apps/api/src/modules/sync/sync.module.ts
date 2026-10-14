import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ClockModule } from '../../common/clock';
import { ShiftExecutionModule } from '../shift-execution/shift-execution.module';
import { CheckpointRecordsModule } from '../checkpoint-records/checkpoint-records.module';
import { ShiftCredentialService } from './shift-credential.service';
import { ShiftCredentialGuard } from './shift-credential.guard';
import { ShiftSyncStateService } from './shift-sync-state.service';
import { SyncBatchService } from './sync-batch.service';
import { SyncBatchController } from './sync-batch.controller';
import { ConnectionNoticesController } from './connection-notices.controller';

@Module({
  imports: [
    PrismaModule,
    ClockModule,
    forwardRef(() => ShiftExecutionModule),
    CheckpointRecordsModule,
  ],
  controllers: [SyncBatchController, ConnectionNoticesController],
  providers: [
    ShiftCredentialService,
    ShiftCredentialGuard,
    ShiftSyncStateService,
    SyncBatchService,
  ],
  exports: [ShiftCredentialService, ShiftCredentialGuard, ShiftSyncStateService, SyncBatchService],
})
export class SyncModule {}
