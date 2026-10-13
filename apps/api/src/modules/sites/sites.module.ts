import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';
import {
  IN_PROGRESS_SHIFT_CLOSURE_PORT,
  NoopInProgressShiftClosure,
  NoopWeeklyScheduleTermination,
  WEEKLY_SCHEDULE_TERMINATION_PORT,
} from './deactivation-ports';
import { ClockModule } from '../../common/clock';

@Module({
  imports: [PrismaModule, ClockModule],
  controllers: [SitesController],
  providers: [
    TenantResourceService,
    SitesService,
    { provide: WEEKLY_SCHEDULE_TERMINATION_PORT, useClass: NoopWeeklyScheduleTermination },
    { provide: IN_PROGRESS_SHIFT_CLOSURE_PORT, useClass: NoopInProgressShiftClosure },
  ],
  exports: [SitesService],
})
export class SitesModule {}
