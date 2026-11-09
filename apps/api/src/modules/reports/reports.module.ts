import { Module } from '@nestjs/common';
import { ClockModule } from '../../common/clock';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [PrismaModule, ClockModule],
  controllers: [ReportsController],
  providers: [ReportsService, TenantResourceService],
})
export class ReportsModule {}
