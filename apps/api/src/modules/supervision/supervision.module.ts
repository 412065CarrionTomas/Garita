import { Module } from '@nestjs/common';
import { ClockModule } from '../../common/clock';
import { PrismaModule } from '../prisma/prisma.module';
import { MarcasModule } from '../marcas/marcas.module';
import { SupervisionController } from './supervision.controller';
import { SupervisionService } from './supervision.service';
import { RoundWindowStateService } from './round-window-state.service';

@Module({
  imports: [PrismaModule, ClockModule, MarcasModule],
  controllers: [SupervisionController],
  providers: [RoundWindowStateService, SupervisionService],
  exports: [RoundWindowStateService],
})
export class SupervisionModule {}
