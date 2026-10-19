import { Test } from '@nestjs/testing';

import type { NotificationsPort } from './notifications.port';
import { NOTIFICATIONS_PORT } from './notifications.port';
import { PortsModule } from './ports.module';
import type { RealtimePort } from './realtime.port';
import { REALTIME_PORT } from './realtime.port';

describe('PortsModule', () => {
  it('resuelve los puertos noop sin error', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PortsModule] }).compile();
    const notifications = moduleRef.get<NotificationsPort>(NOTIFICATIONS_PORT);
    const realtime = moduleRef.get<RealtimePort>(REALTIME_PORT);
    const payload = { kind: 'incident_new' as const, link: '/incidentes/1' };

    await expect(
      notifications.notifySiteStaff({ companyId: 'c', siteId: 's', kind: 'incident_new', payload }),
    ).resolves.toBeUndefined();
    await expect(
      notifications.notifyUsers({ companyId: 'c', userIds: ['u'], kind: 'incident_new', payload }),
    ).resolves.toBeUndefined();
    expect(() => {
      realtime.emitToSite('c', 's', 'incidente.nuevo', { incidentId: 'i', siteId: 's' });
    }).not.toThrow();
  });
});
