import { Global, Module } from '@nestjs/common';

import { NOTIFICATIONS_PORT } from './notifications.port';
import { NoopRealtime, REALTIME_PORT } from './realtime.port';
import { NotificationsModule } from '../../modules/notifications/notifications.module';
import { NotificationsService } from '../../modules/notifications/notifications.service';

@Global()
@Module({
  imports: [NotificationsModule],
  providers: [
    { provide: NOTIFICATIONS_PORT, useExisting: NotificationsService },
    { provide: REALTIME_PORT, useClass: NoopRealtime },
  ],
  exports: [NOTIFICATIONS_PORT, REALTIME_PORT],
})
export class PortsModule {}
