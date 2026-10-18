import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ClockModule } from '../../common/clock';
import { ShiftCredentialService } from './shift-credential.service';
import { ShiftCredentialGuard } from './shift-credential.guard';

@Module({
  imports: [PrismaModule, ClockModule],
  providers: [ShiftCredentialService, ShiftCredentialGuard],
  exports: [ShiftCredentialService, ShiftCredentialGuard],
})
export class ShiftCredentialModule {}
