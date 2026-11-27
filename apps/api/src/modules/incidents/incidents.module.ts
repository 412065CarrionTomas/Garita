import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClockModule } from '../../common/clock';
import { PortsModule } from '../../common/ports/ports.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ShiftCredentialModule } from '../sync/shift-credential.module';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
import { CloudinaryPhotoStorage, PHOTO_STORAGE_PORT } from './photo-storage.port';
import { IncidentClassificationController } from './incident-classification.controller';
import { IncidentClassificationService } from './incident-classification.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    ConfigModule,
    ClockModule,
    PortsModule,
    PrismaModule,
    ShiftCredentialModule,
    AuthModule,
  ],
  controllers: [IncidentsController, IncidentClassificationController],
  providers: [
    IncidentsService,
    IncidentClassificationService,
    CloudinaryPhotoStorage,
    { provide: PHOTO_STORAGE_PORT, useExisting: CloudinaryPhotoStorage },
  ],
  exports: [IncidentsService, PHOTO_STORAGE_PORT],
})
export class IncidentsModule {}
