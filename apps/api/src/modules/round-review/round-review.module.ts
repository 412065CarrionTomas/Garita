import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ClockModule } from '../../common/clock';
import { SupervisionModule } from '../supervision/supervision.module';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { RoundReviewController } from './round-review.controller';
import { RoundReviewService } from './round-review.service';

@Module({
  imports: [PrismaModule, ClockModule, SupervisionModule],
  controllers: [RoundReviewController],
  providers: [RoundReviewService, TenantResourceService],
})
export class RoundReviewModule {}
