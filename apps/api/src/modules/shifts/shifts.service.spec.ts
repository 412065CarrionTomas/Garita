import { ShiftsService } from './shifts.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantResourceService } from '../auth/tenant-resource.service';

it.each([
  ['invitation_pending', false, 'shift_without_guard', 'shift', 'guard_assigned', 'absent'],
  ['active', false, 'shift_not_started', 'previous', 'reassigned', 'absent'],
  [null, false, 'shift_without_guard', 'shift', 'guard_assigned', 'replaced'],
  ['active', true, 'shift_closed_early', 'previous', 'covered', 'closed_early'],
])(
  'reasignar con estado %s y cobertura %s resuelve solo el aviso correspondiente',
  async (status, covering, kind, subjectId, resolution, priorResult) => {
    const now = new Date('2030-05-10T22:30:00Z');
    const startsAt = new Date('2030-05-10T22:00:00Z');
    const endsAt = new Date('2030-05-11T06:00:00Z');
    const current = {
      id: 'previous',
      guardId: status ? 'previous-guard' : null,
      guard: status ? { status } : null,
      startsAt,
      endsAt,
    };
    const shift = {
      id: 'shift',
      companyId: 'company',
      siteId: 'site',
      status: covering ? 'closed' : status ? 'scheduled' : 'unassigned',
      closedEarly: covering,
      closeReason: covering ? 'Fin anticipado' : null,
      endsAt,
      assignments: [current],
      site: {
        company: { timezone: 'America/Argentina/Buenos_Aires' },
        connectivityType: 'with_signal',
        minutesToSignal: 0,
      },
    };
    const tx = {
      shiftAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'replacement' }),
      },
      shift: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      tenantPrisma: {
        shift: { findFirst: jest.fn().mockResolvedValueOnce(shift).mockResolvedValueOnce(null) },
        user: { findFirst: jest.fn().mockResolvedValue({ id: 'new-guard' }) },
        $transaction: jest.fn((action: (transaction: typeof tx) => Promise<unknown>) => action(tx)),
      },
    };
    const resolve = jest.fn().mockResolvedValue(undefined),
      notifyUsers = jest.fn().mockResolvedValue(undefined);
    const service = new ShiftsService(
      prisma as unknown as PrismaService,
      {
        findOwnedOrThrow: jest.fn().mockResolvedValue(undefined),
      } as unknown as TenantResourceService,
      { now: () => now },
      { notifyUsers, notifySiteStaff: jest.fn() },
      { resolve, raise: jest.fn() },
      { emitToSite: jest.fn() },
    );
    await service.reassign(
      'shift',
      { guardId: 'new-guard' },
      { userId: 'admin', companyId: 'company', role: 'admin', status: 'active' },
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({ companyId: 'company', kind, subjectId, resolution });
    expect(tx.shiftAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: 'previous', isCurrent: true, result: covering ? 'closed_early' : 'scheduled' },
      data: { isCurrent: false, active: false, result: priorResult },
    });
    expect(notifyUsers).toHaveBeenCalledTimes(status ? 2 : 1);
    if (status)
      expect(notifyUsers).toHaveBeenCalledWith(
        expect.objectContaining({ userIds: ['previous-guard'], kind: 'shift_reassigned_from_you' }),
      );
    expect(notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['new-guard'], kind: 'shift_reassigned_to_you' }),
    );
  },
);
