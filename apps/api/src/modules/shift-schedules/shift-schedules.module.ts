import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { ShiftSchedulesController } from './shift-schedules.controller';
import { ShiftSchedulesService } from './shift-schedules.service';
import { ScheduleLifecycleService } from './schedule-lifecycle.service';

@Module({
  imports: [PrismaModule, ShiftsModule],
  controllers: [ShiftSchedulesController],
  providers: [TenantResourceService, ShiftSchedulesService, ScheduleLifecycleService],
  exports: [ScheduleLifecycleService],
})
export class ShiftSchedulesModule {}
