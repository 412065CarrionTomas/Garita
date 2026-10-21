import { Test } from '@nestjs/testing';

import type { RealtimePort } from './realtime.port';
import { SocketRealtimeService } from '../../modules/realtime/socket-realtime.service';

describe('SocketRealtimeService', () => {
  it('implements the typed realtime port without throwing before a gateway connects', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [SocketRealtimeService],
    }).compile();
    const realtime: RealtimePort = moduleRef.get(SocketRealtimeService);
    expect(() => {
      realtime.emitToSite('c', 's', 'incidente.nuevo', { incidentId: 'i', siteId: 's' });
    }).not.toThrow();
  });
});
