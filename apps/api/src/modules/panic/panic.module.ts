import { Module } from '@nestjs/common';
import { ClockModule } from '../../common/clock';
import { PortsModule } from '../../common/ports/ports.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ShiftCredentialModule } from '../sync/shift-credential.module';
import { PanicController } from './panic.controller';
import { PanicService } from './panic.service';

@Module({
  imports: [ClockModule, PortsModule, PrismaModule, ShiftCredentialModule],
  controllers: [PanicController],
  providers: [PanicService],
  exports: [PanicService],
})
export class PanicModule {}
