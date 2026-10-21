import { NotificationsProcessor } from './notifications.processor';

describe('NotificationsProcessor', () => {
  const activeUsers = jest.fn();
  const findDevices = jest.fn();
  const deleteDevices = jest.fn();
  const send = jest.fn();
  const processor = new NotificationsProcessor(
    {
      systemPrisma: {
        user: { findMany: activeUsers },
        notificationDevice: { findMany: findDevices, deleteMany: deleteDevices },
      },
    } as never,
    { sendEachForMulticast: send },
    { get: () => 'https://panel.garita.example' } as never,
  );
  const job = {
    data: {
      companyId: 'company-1',
      userIds: ['supervisor-1'],
      payload: { kind: 'round_missed', siteName: 'Depósito Ruta 9', link: '/rondas/1' },
    },
  } as Parameters<typeof processor.process>[0];

  beforeEach(() => {
    jest.clearAllMocks();
    activeUsers.mockResolvedValue([{ id: 'supervisor-1' }]);
    findDevices.mockResolvedValue([
      { token: 'token-web-1', kind: 'web' },
      { token: 'token-app-1', kind: 'app' },
    ]);
    deleteDevices.mockResolvedValue({ count: 1 });
    send.mockResolvedValue({
      successCount: 1,
      failureCount: 1,
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
    });
  });

  it('multicasts to every active recipient device and removes invalid tokens', async () => {
    await processor.process(job);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ['token-web-1', 'token-app-1'],
        notification: { title: 'Ronda incumplida', body: 'Depósito Ruta 9' },
        webpush: { fcmOptions: { link: 'https://panel.garita.example/rondas/1' } },
      }),
    );
    expect(deleteDevices).toHaveBeenCalledWith({ where: { token: { in: ['token-app-1'] } } });
  });

  it('does not deliver to a deactivated user', async () => {
    activeUsers.mockResolvedValue([]);
    findDevices.mockResolvedValue([]);
    await processor.process(job);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects extra queue payload fields before sending', async () => {
    const invalidJob = {
      data: { ...job.data, payload: { ...job.data.payload, address: 'private' } },
    } as unknown as Parameters<typeof processor.process>[0];
    await expect(processor.process(invalidJob)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
