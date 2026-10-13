import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { NfcTagsController } from './nfc-tags.controller';
import { NfcTagsService } from './nfc-tags.service';

@Module({
  imports: [PrismaModule],
  controllers: [NfcTagsController],
  providers: [TenantResourceService, NfcTagsService],
})
export class NfcTagsModule {}
