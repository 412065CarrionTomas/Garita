import { Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';
import { TenantContext } from '../auth/tenant-context';

@Module({
  providers: [PrismaService, TenantContext],
  exports: [PrismaService, TenantContext],
})
export class PrismaModule {}
