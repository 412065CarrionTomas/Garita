import { ShiftGuardLeaveEffects } from './shift-guard-leave.effects';

describe('ShiftGuardLeaveEffects', () => {
  const findShift = jest.fn();
  const findGuard = jest.fn();
  const notifyUsers = jest.fn();
  const sendShiftClosed = jest.fn();
  const emitToSite = jest.fn();
  const effects = new ShiftGuardLeaveEffects(
    {
      tenantPrisma: { shift: { findUnique: findShift }, user: { findUnique: findGuard } },
    } as never,
    { notifyUsers } as never,
    { sendShiftClosed, sendPanicAlert: jest.fn() },
    { emitToSite },
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

  it('offers coverage in the live detail after an early close', async () => {
    findShift.mockResolvedValue({
      companyId: 'company-1',
      siteId: 'site-1',
      status: 'closed',
      closedEarly: true,
      closeReason: 'Me descompuse',
    });
    await effects.offerCoverage('shift-1');
    expect(emitToSite).toHaveBeenCalledWith('company-1', 'site-1', 'turno.actualizado', {
      shiftId: 'shift-1',
      siteId: 'site-1',
    });
    expect(notifyUsers).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'closed', closedEarly: true, closeReason: 'baja del predio' },
    { status: 'closed', closedEarly: false, closeReason: null },
    { status: 'in_progress', closedEarly: false, closeReason: null },
  ])('does not offer coverage for %j', async (shift) => {
    findShift.mockResolvedValue(shift);
    await effects.offerCoverage('shift-1');
    expect(emitToSite).not.toHaveBeenCalled();
  });
});
