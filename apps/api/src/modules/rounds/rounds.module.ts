import { Module } from '@nestjs/common';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RoundsController } from './rounds.controller';
import { RoundsService } from './rounds.service';

@Module({
  imports: [PrismaModule],
  controllers: [RoundsController],
  providers: [RoundsService, TenantResourceService],
})
export class RoundsModule {}
