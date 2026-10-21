import { Injectable, Logger, Optional } from '@nestjs/common';
import type { RealtimeEventName, RealtimeEventPayloads } from '@garita/shared';
import type { RealtimePort } from '../../common/ports/realtime.port';
import { RealtimeGateway } from './realtime.gateway';

@Injectable()
export class SocketRealtimeService implements RealtimePort {
  private readonly logger = new Logger(SocketRealtimeService.name);

  constructor(@Optional() private readonly gateway?: RealtimeGateway) {}

  emitToSite<E extends RealtimeEventName>(
    companyId: string,
    siteId: string,
    event: E,
    payload: RealtimeEventPayloads[E],
  ): void {
    this.logger.debug({ event: 'realtime.emitted', companyId, siteId, name: event });
    this.gateway?.server.to(`site:${siteId}`).emit(event, payload);
  }
}
