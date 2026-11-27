import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ViewPreferencesController } from './view-preferences.controller';
import { ViewPreferencesService } from './view-preferences.service';

@Module({
  imports: [PrismaModule],
  controllers: [ViewPreferencesController],
  providers: [ViewPreferencesService],
})
export class ViewPreferencesModule {}
