import { Module } from '@nestjs/common';
import { ClockModule } from '../../common/clock';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportScopeService } from './incident-reports-scope.service';
import { IncidentReportsService } from './incident-reports.service';
import { IncidentReportsController } from './incident-reports.controller';

@Module({
  imports: [PrismaModule, ClockModule],
  controllers: [ReportsController, IncidentReportsController],
  providers: [ReportsService, TenantResourceService, ReportScopeService, IncidentReportsService],
})
export class ReportsModule {}
