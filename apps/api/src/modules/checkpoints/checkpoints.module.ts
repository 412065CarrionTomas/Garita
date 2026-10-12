import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { SitesModule } from '../sites/sites.module';
import { CheckpointsController } from './checkpoints.controller';
import { CHECKPOINT_USAGE_PORT, EmptyCheckpointUsageAdapter } from './checkpoints-usage.port';
import { CheckpointsService } from './checkpoints.service';
import { QR_CONSTANT_TIME_COMPARE, QrService } from './qr.service';
import * as crypto from 'node:crypto';

@Module({
  imports: [PrismaModule, SitesModule],
  controllers: [CheckpointsController],
  providers: [
    TenantResourceService,
    CheckpointsService,
    QrService,
    { provide: QR_CONSTANT_TIME_COMPARE, useValue: crypto.timingSafeEqual },
    { provide: CHECKPOINT_USAGE_PORT, useClass: EmptyCheckpointUsageAdapter },
  ],
  exports: [CheckpointsService, QrService, CHECKPOINT_USAGE_PORT],
})
export class CheckpointsModule {}
