import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const userFindMany = jest.fn().mockResolvedValue([{ id: 'admin-1' }, { id: 'supervisor-1' }]);
  const queueAdd = jest.fn().mockResolvedValue(undefined);
  const service = new NotificationsService(
    { systemPrisma: { user: { findMany: userFindMany } } } as never,
    { add: queueAdd } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    userFindMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'supervisor-1' }]);
  });

  it('queues only active admins and assigned supervisors for the site', async () => {
    await service.notifySiteStaff({
      companyId: 'company-1',
      siteId: 'site-1',
      kind: 'incident_new',
      payload: { kind: 'incident_new', siteName: 'Depósito', link: '/incidentes/1' },
    });
    expect(userFindMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        status: 'active',
        OR: [
          { role: 'admin' },
          {
            role: 'supervisor',
            siteAssignments: {
              some: { siteId: 'site-1', site: { companyId: 'company-1', status: 'active' } },
            },
          },
        ],
      },
      select: { id: true },
    });
    expect(queueAdd).toHaveBeenCalledWith(
      'send-notification',
      expect.objectContaining({ userIds: ['admin-1', 'supervisor-1'] }),
      expect.any(Object),
    );
  });

  it('rejects payload fields outside the shared strict schema', async () => {
    await expect(
      service.notifyUsers({
        companyId: 'company-1',
        userIds: ['user-1'],
        kind: 'incident_new',
        payload: { kind: 'incident_new', link: '/x', userName: 'private' } as never,
      }),
    ).rejects.toThrow();
    expect(queueAdd).not.toHaveBeenCalled();
  });
});
