import { CoverageNoticesModule } from './modules/coverage-notices/coverage-notices.module';
import { NotificationPreferencesModule } from './modules/notification-preferences/notification-preferences.module';
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
import { PortsModule } from './common/ports/ports.module';
import { ShiftsModule } from './modules/shifts/shifts.module';
import { ShiftExecutionModule } from './modules/shift-execution/shift-execution.module';
import { CheckpointRecordsModule } from './modules/checkpoint-records/checkpoint-records.module';
import { MarcasModule } from './modules/marcas/marcas.module';
import { SyncModule } from './modules/sync/sync.module';
import { ServerTimeModule } from './modules/server-time/server-time.module';
import { SupervisionModule } from './modules/supervision/supervision.module';
import { RoundReviewModule } from './modules/round-review/round-review.module';
import { PanicModule } from './modules/panic/panic.module';
import { NoticesModule } from './modules/notices/notices.module';
import { CompanyModule } from './modules/company/company.module';
import { ReportsModule } from './modules/reports/reports.module';
import { PortalModule } from './modules/portal/portal.module';
import { ReportExportsModule } from './modules/report-exports/report-exports.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { SmsModule } from './modules/sms/sms.module';

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
    PortsModule,
    ShiftsModule,
    ShiftExecutionModule,
    CheckpointRecordsModule,
    MarcasModule,
    SyncModule,
    ServerTimeModule,
    SupervisionModule,
    RoundReviewModule,
    PanicModule,
    NoticesModule,
    CompanyModule,
    ReportsModule,
    PortalModule,
    ReportExportsModule,
    CoverageNoticesModule,
    NotificationPreferencesModule,
    SubscriptionsModule,
    SmsModule,
  ],
})
export class AppModule {}
