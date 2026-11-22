import { SiteConnectivityService } from './site-connectivity.service';
import { SiteConnectivityController } from './site-connectivity.controller';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';
import {
  IN_PROGRESS_SHIFT_CLOSURE_PORT,
  WEEKLY_SCHEDULE_TERMINATION_PORT,
} from './deactivation-ports';
import { ClockModule } from '../../common/clock';
import { ShiftExecutionModule } from '../shift-execution/shift-execution.module';
import { ShiftExecutionService } from '../shift-execution/shift-execution.service';
import { ShiftSchedulesModule } from '../shift-schedules/shift-schedules.module';
import { ScheduleLifecycleService } from '../shift-schedules/schedule-lifecycle.service';

@Module({
  imports: [AuthModule, PrismaModule, ClockModule, ShiftExecutionModule, ShiftSchedulesModule],
  controllers: [SitesController, SiteConnectivityController],
  providers: [
    TenantResourceService,
    SitesService,
    SiteConnectivityService,
    { provide: WEEKLY_SCHEDULE_TERMINATION_PORT, useExisting: ScheduleLifecycleService },
    { provide: IN_PROGRESS_SHIFT_CLOSURE_PORT, useExisting: ShiftExecutionService },
  ],
  exports: [SitesService],
})
export class SitesModule {}
