import { ShiftGuardLeaveEffects } from './shift-guard-leave.effects';

describe('ShiftGuardLeaveEffects', () => {
  const findShift = jest.fn();
  const findGuard = jest.fn();
  const notifyUsers = jest.fn();
  const sendShiftClosed = jest.fn();
  const effects = new ShiftGuardLeaveEffects(
    {
      tenantPrisma: { shift: { findUnique: findShift }, user: { findUnique: findGuard } },
    } as never,
    { notifyUsers } as never,
    { sendShiftClosed } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findShift.mockResolvedValue({
      companyId: 'company-1',
      startsAt: new Date('2030-10-05T21:00:00Z'),
      status: 'closed',
      closeReason: 'baja del predio',
      site: { company: { timezone: 'UTC' } },
    });
    findGuard.mockResolvedValue({ phone: '+541100000000' });
    notifyUsers.mockResolvedValue(undefined);
    sendShiftClosed.mockResolvedValue(undefined);
  });

  it('notifies the assigned guard and requests SMS after site closure', async () => {
    await effects.notifyGuardToLeave(undefined, 'shift-1', 'guard-1');
    expect(notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        userIds: ['guard-1'],
        kind: 'shift_closed_site_removed',
      }),
    );
    expect(sendShiftClosed).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '+541100000000',
        shiftId: 'shift-1',
        guardId: 'guard-1',
      }),
    );
    expect(JSON.stringify(notifyUsers.mock.calls[0])).not.toMatch(/Predio A|Calle 123/);
  });

  it('does not send for another closure reason', async () => {
    findShift.mockResolvedValue({ status: 'closed', closeReason: 'otro' });
    await effects.notifyGuardToLeave(undefined, 'shift-1', 'guard-1');
    expect(notifyUsers).not.toHaveBeenCalled();
    expect(sendShiftClosed).not.toHaveBeenCalled();
  });
});
