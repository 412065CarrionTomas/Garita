import { CoverageNoticesService } from './coverage-notices.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RaiseNoticeInput, NoticesPort } from '../../common/ports/notices.port';
import type { AccountStatePort } from '../../common/ports/account-state.port';

function setup() {
  let now = new Date('2030-01-01T22:14:00Z');
  const site = {
    id: 'site',
    companyId: 'company',
    connectivityType: 'with_signal',
    minutesToSignal: 0,
    marginMinutes: 30,
  };
  const assignment = {
    id: 'assignment',
    startsAt: new Date('2030-01-01T22:00:00Z'),
    result: 'scheduled',
    guard: { status: 'active' },
  };
  const shift = {
    id: 'shift',
    status: 'scheduled',
    startsAt: assignment.startsAt,
    endsAt: new Date('2030-01-02T06:00:00Z'),
    assignments: [assignment],
  };
  const raise = jest.fn<Promise<void>, [RaiseNoticeInput]>().mockResolvedValue(undefined);
  const findShifts = jest.fn().mockResolvedValue([shift]);
  const event = {
    assignmentId: 'assignment',
    actorUserId: 'guard',
    type: 'close',
    reason: 'Me descompuse',
    occurredAt: new Date('2030-01-01T17:00:00Z'),
    receivedAt: new Date('2030-01-01T20:20:00Z'),
  };
  const closed = {
    companyId: 'company',
    siteId: 'site',
    closedEarly: true,
    closeReason: event.reason,
    closedBy: 'guard',
    endsAt: new Date('2030-01-01T18:00:00Z'),
    site: { company: { timezone: 'America/Argentina/Buenos_Aires' } },
  };
  const prisma = {
    systemPrisma: {
      site: { findMany: jest.fn().mockResolvedValue([site]) },
      shift: {
        findMany: findShifts,
        findUnique: jest.fn().mockResolvedValue(closed),
        updateMany: jest.fn(),
      },
      shiftAssignment: { updateMany: jest.fn() },
      shiftEvent: { findFirst: jest.fn().mockResolvedValue(event) },
      user: { findFirst: jest.fn().mockResolvedValue({ firstName: 'Pedro', lastName: 'Díaz' }) },
    },
  };
  const service = new CoverageNoticesService(
    prisma as unknown as PrismaService,
    { now: () => now },
    { raise } as unknown as NoticesPort,
    { get: () => Promise.resolve({ status: 'active' }) } as unknown as AccountStatePort,
  );
  return {
    service,
    raise,
    assignment,
    shift,
    site,
    event,
    closed,
    prisma,
    setNow: (value: string) => {
      now = new Date(value);
    },
  };
}

describe('HU-35 barrido de cobertura con CLOCK', () => {
  it('CA1: no avisa a las 22:14 y avisa desde las 22:15 con la clave de asignación', async () => {
    const f = setup();
    await f.service.sweep();
    expect(f.raise).not.toHaveBeenCalled();
    f.setNow('2030-01-01T22:15:00Z');
    await f.service.sweep();
    expect(f.raise).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'shift_not_started', subjectId: 'assignment' }),
    );
    expect(f.prisma.systemPrisma.shift.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company',
          siteId: 'site',
          endsAt: { gt: new Date('2030-01-01T22:15:00Z') },
        }) as unknown,
      }),
    );
  });
  it('CA7: la nueva asignación tiene su propia clave y tolerancia', async () => {
    const f = setup();
    f.assignment.id = 'replacement';
    f.assignment.startsAt = new Date('2030-01-01T23:00:00Z');
    f.setNow('2030-01-01T23:14:00Z');
    await f.service.sweep();
    expect(f.raise).not.toHaveBeenCalled();
    f.setNow('2030-01-01T23:15:00Z');
    await f.service.sweep();
    expect(f.raise).toHaveBeenCalledWith(expect.objectContaining({ subjectId: 'replacement' }));
  });
  it.each(['unassigned', 'invitation_pending'])(
    'CA8: %s avisa a las 19:30, nunca no iniciado',
    async (kind) => {
      const f = setup();
      if (kind === 'unassigned') f.shift.status = 'unassigned';
      else f.assignment.guard.status = kind;
      f.setNow('2030-01-01T19:29:00Z');
      await f.service.sweep();
      expect(f.raise).not.toHaveBeenCalled();
      f.setNow('2030-01-01T19:30:00Z');
      await f.service.sweep();
      f.setNow('2030-01-01T22:30:00Z');
      await f.service.sweep();
      expect(
        f.raise.mock.calls.every(
          ([input]: [{ kind: string }]) => input.kind === 'shift_without_guard',
        ),
      ).toBe(true);
      expect(f.raise).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'shift_without_guard', subjectId: 'shift' }),
      );
    },
  );
  it('CA8 sin señal: usa la ventana compartida menos dos horas', async () => {
    const f = setup();
    f.site.connectivityType = 'without_signal';
    f.site.minutesToSignal = 180;
    f.site.marginMinutes = 20;
    f.shift.status = 'unassigned';
    f.setNow('2030-01-01T16:39:00Z');
    await f.service.sweep();
    expect(f.raise).not.toHaveBeenCalled();
    f.setNow('2030-01-01T16:40:00Z');
    await f.service.sweep();
    expect(f.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'shift_without_guard' }));
  });
  it('HU-43 suspendida: omite ambos avisos del barrido, conserva el cierre temprano', async () => {
    const f = setup();
    jest.spyOn(f.service, 'isCompanySuspended').mockResolvedValue(true);
    f.setNow('2030-01-01T22:30:00Z');
    await f.service.sweep();
    expect(f.raise).not.toHaveBeenCalled();
    f.shift.status = 'unassigned';
    await f.service.sweep();
    expect(f.raise).not.toHaveBeenCalled();
    await f.service.notifyEarlyClose('shift', 'guard', null);
    expect(f.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: 'shift_closed_early' }));
  });
  it.each(['guard', 'admin'])(
    'CA5/CA6: cierre de %s conserva actor, motivo y horas sin datos personales en push',
    async (by) => {
      const f = setup();
      f.closed.closedBy = by;
      f.event.type = by === 'admin' ? 'admin_close' : 'close';
      await f.service.notifyEarlyClose('shift', 'guard', f.event.reason);
      expect(f.raise).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectId: 'assignment',
          kind: 'shift_closed_early',
          details: expect.objectContaining({
            closedBy: by,
            closedByUserId: 'guard',
            closedByName: 'Pedro Díaz',
            reason: 'Me descompuse',
            late: true,
            closedAt: '2030-01-01T17:00:00.000Z',
            receivedAt: '2030-01-01T20:20:00.000Z',
          }) as unknown,
          pushBody: 'Cerrado a las 14:00, recibido a las 17:20',
        }),
      );
    },
  );
  it('excluye baja del predio, cierres normales y eventos ausentes', async () => {
    const f = setup();
    f.closed.closeReason = 'baja del predio';
    await f.service.notifyEarlyClose('shift', 'guard', null);
    expect(f.raise).not.toHaveBeenCalled();
    f.closed.closeReason = 'Otro';
    f.closed.closedEarly = false;
    await f.service.notifyEarlyClose('shift', 'guard', null);
    expect(f.raise).not.toHaveBeenCalled();
    f.closed.closedEarly = true;
    f.prisma.systemPrisma.shiftEvent.findFirst.mockResolvedValue(null);
    await f.service.notifyEarlyClose('shift', 'guard', null);
    expect(f.raise).not.toHaveBeenCalled();
  });
  it('un minuto exacto no es tardío y no agrega body', async () => {
    const f = setup();
    f.event.receivedAt = new Date(f.event.occurredAt.getTime() + 60_000);
    await f.service.notifyEarlyClose('shift', 'guard', null);
    expect(f.raise.mock.calls[0]?.[0]).toMatchObject({ details: { late: false } });
    expect(f.raise.mock.calls[0]?.[0]).not.toHaveProperty('pushBody');
  });
});
