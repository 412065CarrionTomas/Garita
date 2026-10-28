import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ClockModule } from '../../common/clock';
import { CheckpointsModule } from '../checkpoints/checkpoints.module';
import { ShiftExecutionModule } from '../shift-execution/shift-execution.module';
import { MarcasModule } from '../marcas/marcas.module';
import { SupervisionModule } from '../supervision/supervision.module';
import { CheckpointRecordsController } from './checkpoint-records.controller';
import { CheckpointRecordsService } from './checkpoint-records.service';

@Module({
  imports: [
    PrismaModule,
    ClockModule,
    CheckpointsModule,
    ShiftExecutionModule,
    MarcasModule,
    SupervisionModule,
  ],
  controllers: [CheckpointRecordsController],
  providers: [CheckpointRecordsService],
  exports: [CheckpointRecordsService],
})
export class CheckpointRecordsModule {}
