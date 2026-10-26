import { Global, Module } from '@nestjs/common';

import { NOTIFICATIONS_PORT } from './notifications.port';
import { REALTIME_PORT } from './realtime.port';
import { NotificationsModule } from '../../modules/notifications/notifications.module';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { RealtimeModule } from '../../modules/realtime/realtime.module';
import { SocketRealtimeService } from '../../modules/realtime/socket-realtime.service';
import { NoopSms, SMS_PORT } from './sms.port';

@Global()
@Module({
  imports: [NotificationsModule, RealtimeModule],
  providers: [
    { provide: NOTIFICATIONS_PORT, useExisting: NotificationsService },
    { provide: REALTIME_PORT, useExisting: SocketRealtimeService },
    { provide: SMS_PORT, useClass: NoopSms },
  ],
  exports: [NOTIFICATIONS_PORT, REALTIME_PORT, SMS_PORT],
})
export class PortsModule {}
