import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ClockModule } from '../../common/clock';
import { PrismaModule } from '../prisma/prisma.module';
import { CoverageNoticesService } from './coverage-notices.service';
import { CoverageNoticesProcessor, COVERAGE_NOTICES_QUEUE } from './coverage-notices.processor';

@Global()
@Module({
  imports: [PrismaModule, ClockModule, BullModule.registerQueue({ name: COVERAGE_NOTICES_QUEUE })],
  providers: [CoverageNoticesService, CoverageNoticesProcessor],
  exports: [CoverageNoticesService],
})
export class CoverageNoticesModule {}
