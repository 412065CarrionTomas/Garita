import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeGateway } from './realtime.gateway';
import { SocketRealtimeService } from './socket-realtime.service';

@Module({
  imports: [ConfigModule, AuthModule, PrismaModule],
  providers: [RealtimeGateway, SocketRealtimeService],
  exports: [SocketRealtimeService],
})
export class RealtimeModule {}
