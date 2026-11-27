import { Module } from '@nestjs/common';
import { ClockModule } from '../../common/clock';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportsModule } from '../reports/reports.module';
import { PortalModule } from '../portal/portal.module';
import { ReportExportsController } from './report-exports.controller';
import { ReportExportsService } from './report-exports.service';

@Module({
  imports: [ClockModule, AuthModule, PrismaModule, ReportsModule, PortalModule],
  controllers: [ReportExportsController],
  providers: [ReportExportsService],
})
export class ReportExportsModule {}
