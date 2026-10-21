import { Global, Module } from '@nestjs/common';

import { NOTIFICATIONS_PORT, NoopNotifications } from './notifications.port';
import { REALTIME_PORT } from './realtime.port';
import { RealtimeModule } from '../../modules/realtime/realtime.module';
import { SocketRealtimeService } from '../../modules/realtime/socket-realtime.service';

@Global()
@Module({
  imports: [RealtimeModule],
  providers: [
    { provide: NOTIFICATIONS_PORT, useClass: NoopNotifications },
    { provide: REALTIME_PORT, useExisting: SocketRealtimeService },
  ],
  exports: [NOTIFICATIONS_PORT, REALTIME_PORT],
})
export class PortsModule {}
