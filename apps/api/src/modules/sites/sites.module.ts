import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';

@Module({
  imports: [PrismaModule],
  controllers: [SitesController],
  providers: [TenantResourceService, SitesService],
  exports: [SitesService],
})
export class SitesModule {}
