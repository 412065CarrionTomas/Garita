import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { MarcasController } from './marcas.controller';
import { MarcasService } from './marcas.service';

@Module({
  imports: [PrismaModule],
  controllers: [MarcasController],
  providers: [MarcasService, TenantResourceService],
  exports: [MarcasService],
})
export class MarcasModule {}
