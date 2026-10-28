import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

@Module({
  imports: [PrismaModule],
  controllers: [ShiftsController],
  providers: [TenantResourceService, ShiftsService],
})
export class ShiftsModule {}
