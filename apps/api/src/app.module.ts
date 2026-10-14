import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import type { Env } from './config/env';
import { validateEnv } from './config/env';
import { buildQueueOptions } from './config/queue.config';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SitesModule } from './modules/sites/sites.module';
import { CheckpointsModule } from './modules/checkpoints/checkpoints.module';
import { NfcTagsModule } from './modules/nfc-tags/nfc-tags.module';
import { RoundsModule } from './modules/rounds/rounds.module';
import { ClockModule } from './common/clock';
import { ShiftsModule } from './modules/shifts/shifts.module';
import { ShiftExecutionModule } from './modules/shift-execution/shift-execution.module';
import { CheckpointRecordsModule } from './modules/checkpoint-records/checkpoint-records.module';
import { SyncModule } from './modules/sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildQueueOptions(config.get('REDIS_URL', { infer: true })),
    }),
    HealthModule,
    AuthModule,
    UsersModule,
    SitesModule,
    CheckpointsModule,
    NfcTagsModule,
    RoundsModule,
    ClockModule,
    ShiftsModule,
    ShiftExecutionModule,
    CheckpointRecordsModule,
    SyncModule,
  ],
})
export class AppModule {}
