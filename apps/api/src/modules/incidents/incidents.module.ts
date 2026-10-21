import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClockModule } from '../../common/clock';
import { PortsModule } from '../../common/ports/ports.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ShiftCredentialModule } from '../sync/shift-credential.module';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
import { CloudinaryPhotoStorage, PHOTO_STORAGE_PORT } from './photo-storage.port';

@Module({
  imports: [ConfigModule, ClockModule, PortsModule, PrismaModule, ShiftCredentialModule],
  controllers: [IncidentsController],
  providers: [
    IncidentsService,
    CloudinaryPhotoStorage,
    { provide: PHOTO_STORAGE_PORT, useExisting: CloudinaryPhotoStorage },
  ],
  exports: [IncidentsService],
})
export class IncidentsModule {}
