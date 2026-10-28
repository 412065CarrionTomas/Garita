import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { MarcasController } from './marcas.controller';
import { MarcasService } from './marcas.service';
import { NfcTagsModule } from '../nfc-tags/nfc-tags.module';

@Module({
  imports: [PrismaModule, NfcTagsModule],
  controllers: [MarcasController],
  providers: [MarcasService, TenantResourceService],
  exports: [MarcasService],
})
export class MarcasModule {}
