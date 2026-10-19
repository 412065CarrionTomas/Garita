import { Global, Module } from '@nestjs/common';

import { NOTIFICATIONS_PORT, NoopNotifications } from './notifications.port';
import { NoopRealtime, REALTIME_PORT } from './realtime.port';

@Global()
@Module({
  providers: [
    { provide: NOTIFICATIONS_PORT, useClass: NoopNotifications },
    { provide: REALTIME_PORT, useClass: NoopRealtime },
  ],
  exports: [NOTIFICATIONS_PORT, REALTIME_PORT],
})
export class PortsModule {}
