import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { NfcTagsController } from './nfc-tags.controller';
import { NfcTagsService } from './nfc-tags.service';
import { SecureTagsController } from './secure/secure-tags.controller';
import { SecureTagsService } from './secure/secure-tags.service';

@Module({
  imports: [PrismaModule],
  controllers: [NfcTagsController, SecureTagsController],
  providers: [TenantResourceService, NfcTagsService, SecureTagsService],
  exports: [NfcTagsService],
})
export class NfcTagsModule {}
