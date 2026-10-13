import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';
import {
  IN_PROGRESS_SHIFT_CLOSURE_PORT,
  NoopWeeklyScheduleTermination,
  WEEKLY_SCHEDULE_TERMINATION_PORT,
} from './deactivation-ports';
import { ClockModule } from '../../common/clock';
import { ShiftExecutionModule } from '../shift-execution/shift-execution.module';
import { ShiftExecutionService } from '../shift-execution/shift-execution.service';

@Module({
  imports: [PrismaModule, ClockModule, ShiftExecutionModule],
  controllers: [SitesController],
  providers: [
    TenantResourceService,
    SitesService,
    { provide: WEEKLY_SCHEDULE_TERMINATION_PORT, useClass: NoopWeeklyScheduleTermination },
    { provide: IN_PROGRESS_SHIFT_CLOSURE_PORT, useExisting: ShiftExecutionService },
  ],
  exports: [SitesService],
})
export class SitesModule {}
