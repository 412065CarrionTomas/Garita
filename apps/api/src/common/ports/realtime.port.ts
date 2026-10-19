import { Injectable } from '@nestjs/common';
import type { RealtimeEventName, RealtimeEventPayloads } from '@garita/shared';

export interface RealtimePort {
  emitToSite<E extends RealtimeEventName>(
    companyId: string,
    siteId: string,
    event: E,
    payload: RealtimeEventPayloads[E],
  ): void;
}

export const REALTIME_PORT = Symbol('REALTIME_PORT');

/** HU-16 replaces this provider in PortsModule. */
@Injectable()
export class NoopRealtime implements RealtimePort {
  emitToSite(): void {
    // Intentionally empty until HU-16 delivers Socket.IO.
  }
}
