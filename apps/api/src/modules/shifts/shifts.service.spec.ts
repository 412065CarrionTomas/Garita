import {
  SCHEDULE_REGENERATION_REASON,
  ShiftsService,
  effectiveShiftStatus,
} from './shifts.service';
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

describe('audit shift list filters', () => {
  const now = new Date('2030-05-10T22:30:00Z');
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const service = new ShiftsService(
    { tenantPrisma: { shift: { findMany, count } } } as unknown as PrismaService,
    {} as TenantResourceService,
    { now: () => now },
    { notifyUsers: jest.fn(), notifySiteStaff: jest.fn() },
    { resolve: jest.fn(), raise: jest.fn() },
    { emitToSite: jest.fn() },
  );
  it('filters by state group (with derived uncovered), searches by word and paginates', async () => {
    const result = await service.list({
      estado: 'problema',
      q: 'ferre  díaz',
      orden: 'predio:asc',
      pagina: 3,
      porPagina: 10,
    });
    const byWord = (word: string) => {
      const search = { contains: word, mode: 'insensitive' };
      return {
        OR: [
          { site: { name: search } },
          {
            assignments: {
              some: {
                isCurrent: true,
                guard: { OR: [{ firstName: search }, { lastName: search }] },
              },
            },
          },
        ],
      };
    };
    const where = {
      AND: [
        {
          OR: [
            { status: { not: 'cancelled' } },
            { cancellationReason: null },
            { cancellationReason: { not: SCHEDULE_REGENERATION_REASON } },
          ],
        },
        {
          OR: [
            { status: { in: ['unassigned', 'uncovered', 'no_show'] } },
            {
              status: 'closed',
              closedEarly: true,
              endsAt: { gt: now },
              OR: [{ closeReason: null }, { closeReason: { not: 'baja del predio' } }],
            },
          ],
        },
        byWord('ferre'),
        byWord('díaz'),
      ],
    };
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where,
        orderBy: [{ site: { name: 'asc' } }, { startsAt: 'desc' }],
        skip: 20,
        take: 10,
      }),
    );
    expect(count).toHaveBeenLastCalledWith({ where });
    expect(result).toEqual({ items: [], total: 0 });
  });
  it('reports a shift closed early and still in its slot as uncovered', () => {
    const endsAt = new Date(now.getTime() + 60_000);
    expect(
      effectiveShiftStatus(
        { status: 'closed', closedEarly: true, closeReason: 'Fin', endsAt },
        now,
      ),
    ).toBe('uncovered');
    expect(
      effectiveShiftStatus(
        { status: 'closed', closedEarly: true, closeReason: 'baja del predio', endsAt },
        now,
      ),
    ).toBe('closed');
    expect(
      effectiveShiftStatus(
        { status: 'closed', closedEarly: true, closeReason: null, endsAt: now },
        now,
      ),
    ).toBe('closed');
  });
  it('includes current running assignments even after scheduled end', async () => {
    await service.mine({ userId: 'guard', companyId: 'company', role: 'guard', status: 'active' });
    expect((findMany.mock.lastCall as unknown[] | undefined)?.[0]).toMatchObject({
      where: {
        OR: [
          { status: 'in_progress' },
          { status: { in: ['scheduled', 'unassigned'] }, endsAt: { gte: now } },
        ],
        assignments: {
          some: {
            guardId: 'guard',
            isCurrent: true,
            active: true,
            startsAt: { lte: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) },
          },
        },
      },
    });
  });
});

describe('guard shifts in a date range', () => {
  const findMany = jest.fn();
  const service = new ShiftsService(
    { tenantPrisma: { shift: { findMany } } } as unknown as PrismaService,
    {} as TenantResourceService,
    { now: () => new Date('2030-05-10T12:00:00Z') },
    { notifyUsers: jest.fn(), notifySiteStaff: jest.fn() },
    { resolve: jest.fn(), raise: jest.fn() },
    { emitToSite: jest.fn() },
  );
  const guard = { userId: 'guard', companyId: 'company', role: 'guard', status: 'active' } as const;
  const win = (status: string, recordedCount: number, startsAt: string, endsAt?: string) => ({
    status,
    recordedCount,
    expectedCount: 4,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt ?? new Date(Date.parse(startsAt) + 3_600_000).toISOString()),
  });
  const row = (id: string, started: boolean) => ({
    id,
    status: started ? 'closed' : 'scheduled',
    serviceDate: new Date('2030-05-09T00:00:00Z'),
    startsAt: new Date('2030-05-09T22:00:00Z'),
    endsAt: new Date('2030-05-10T06:00:00Z'),
    startedAt: started ? new Date('2030-05-09T22:03:00Z') : null,
    closedAt: started ? new Date('2030-05-10T06:01:00Z') : null,
    site: { id: 'site', name: 'Predio', company: { timezone: 'America/Argentina/Cordoba' } },
    rounds: [
      {
        roundVersionId: started ? 'v1' : null,
        round: { name: 'Perimetral', currentVersionId: 'v2' },
      },
    ],
    assignments: [
      { startsAt: new Date('2030-05-09T23:00:00Z'), endsAt: new Date('2030-05-10T06:00:00Z') },
    ],
    roundWindowStates: [
      win('complete', 4, '2030-05-09T23:00:00Z'),
      win('complete_late', 3, '2030-05-10T01:00:00Z'),
      win('not_done', 0, '2030-05-10T03:00:00Z'),
      // Del vigilador relevado, antes de la asignación: no cuenta.
      win('complete', 4, '2030-05-09T22:00:00Z', '2030-05-09T23:00:00Z'),
    ],
    _count: { incidents: 2 },
  });

  it('filters by service date and own assignment, and summarizes only started shifts', async () => {
    findMany.mockResolvedValueOnce([row('a', true), row('b', false)]);
    const page = await service.mineInRange(guard, { desde: '2030-05-01', hasta: '2030-05-31' });
    expect((findMany.mock.lastCall as unknown[] | undefined)?.[0]).toMatchObject({
      where: {
        serviceDate: { gte: new Date('2030-04-30'), lte: new Date('2030-05-31') },
        assignments: { some: { guardId: 'guard', isCurrent: true } },
        NOT: { status: 'cancelled', cancellationReason: SCHEDULE_REGENERATION_REASON },
      },
      take: 51,
    });
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toEqual({
      id: 'a',
      status: 'closed',
      serviceDate: '2030-05-09',
      startsAt: '2030-05-09T23:00:00.000Z',
      endsAt: '2030-05-10T06:00:00.000Z',
      startedAt: '2030-05-09T22:03:00.000Z',
      closedAt: '2030-05-10T06:01:00.000Z',
      site: { id: 'site', name: 'Predio', timezone: 'America/Argentina/Cordoba' },
      rounds: [{ name: 'Perimetral', versionId: 'v1' }],
      summary: { windows: 3, windowsDone: 2, recorded: 7, expected: 12, incidents: 2 },
    });
    expect(page.items[1]?.summary).toBeNull();
    // Sin iniciar sigue la versión vigente de la ronda.
    expect(page.items[1]?.rounds).toEqual([{ name: 'Perimetral', versionId: 'v2' }]);
  });

  it('pages with a cursor after the last returned shift', async () => {
    findMany.mockResolvedValueOnce(Array.from({ length: 51 }, (_, i) => row(`s${i}`, false)));
    const page = await service.mineInRange(guard, {
      desde: '2030-01-01',
      hasta: '2030-12-31',
      cursor: 'prev',
    });
    expect((findMany.mock.lastCall as unknown[] | undefined)?.[0]).toMatchObject({
      cursor: { id: 'prev' },
      skip: 1,
    });
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).toBe('s49');
  });

  it('counts an overnight shift on the day it ends, but not one that ends before the range', async () => {
    const overnight = row('night', false); // 22:00 del 9 a 06:00 UTC del 10 (03:00 en Córdoba)
    const evening = {
      ...row('evening', false),
      assignments: [
        { startsAt: new Date('2030-05-09T18:00:00Z'), endsAt: new Date('2030-05-10T03:00:00Z') },
      ], // termina 00:00 del 10 en Córdoba: no toca el 10
    };
    findMany.mockResolvedValueOnce([overnight, evening]);
    const page = await service.mineInRange(guard, { desde: '2030-05-10', hasta: '2030-05-10' });
    expect(page.items.map((s) => s.id)).toEqual(['night']);
  });
});

describe('weekly shift board', () => {
  const shift = (overrides: Record<string, unknown>) => ({
    id: 'night',
    siteId: 'site-b',
    site: { name: 'Barrio' },
    status: 'scheduled',
    startsAt: new Date('2026-11-24T01:00:00Z'),
    endsAt: new Date('2026-11-24T09:00:00Z'),
    serviceDate: new Date('2026-11-23T00:00:00Z'),
    scheduleId: 'schedule',
    individuallyModified: false,
    assignments: [{ guard: { id: 'g1', firstName: 'Valentina', lastName: 'Castro' } }],
    rounds: [{ round: { name: 'Perimetral' } }],
    ...overrides,
  });
  const findMany = jest.fn().mockResolvedValue([
    shift({}),
    shift({
      id: 'early',
      status: 'closed',
      closedEarly: true,
      closeReason: 'Descompostura',
      startsAt: new Date('2026-11-26T01:00:00Z'),
      endsAt: new Date('2026-11-26T09:00:00Z'),
      serviceDate: new Date('2026-11-25T00:00:00Z'),
    }),
    shift({
      id: 'live',
      status: 'no_show',
      startsAt: new Date('2026-11-26T04:00:00Z'),
      endsAt: new Date('2026-11-26T12:00:00Z'),
      serviceDate: new Date('2026-11-26T00:00:00Z'),
    }),
    shift({
      id: 'gap',
      status: 'unassigned',
      startsAt: new Date('2026-11-30T01:00:00Z'),
      endsAt: new Date('2026-11-30T09:00:00Z'),
      serviceDate: new Date('2026-11-29T00:00:00Z'),
      scheduleId: null,
      assignments: [],
    }),
  ]);
  const service = new ShiftsService(
    {
      tenantPrisma: {
        company: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            timezone: 'America/Argentina/Buenos_Aires',
          }),
        },
        shift: { findMany },
        site: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'site-b', name: 'Barrio' },
            { id: 'site-a', name: 'Acopio' },
          ]),
        },
      },
    } as unknown as PrismaService,
    {} as TenantResourceService,
    // Jueves 26/11 a las 02:00 en Buenos Aires.
    { now: () => new Date('2026-11-26T05:00:00Z') },
    { notifyUsers: jest.fn(), notifySiteStaff: jest.fn() },
    { resolve: jest.fn(), raise: jest.fn() },
    { emitToSite: jest.fn() },
  );
  const user = { userId: 'u', companyId: 'company', role: 'admin', status: 'active' } as const;

  it('places a night shift on its start day, keeps empty sites and splits gaps by action', async () => {
    const board = await service.board({}, user);
    expect(board.today).toBe('2026-11-26');
    expect(board.days[0]).toBe('2026-11-23');
    expect(board.sites.map((site) => site.name)).toEqual(['Acopio', 'Barrio']);
    const [, barrio] = board.sites;
    if (!barrio) throw new Error('Falta el predio Barrio');
    expect(barrio.days[0]).toEqual([
      expect.objectContaining({
        id: 'night',
        origin: 'schedule',
        guard: { id: 'g1', name: 'Valentina Castro' },
        rounds: ['Perimetral'],
      }),
    ]);
    expect(barrio.days[6]).toEqual([
      expect.objectContaining({ id: 'gap', origin: 'manual', guard: null }),
    ]);
    expect(board.summary).toEqual({ total: 4, sites: 1, toAssign: 1, toCover: 1, noShows: 1 });
    expect(barrio.days[2]).toEqual([expect.objectContaining({ id: 'early', status: 'uncovered' })]);
    expect((findMany.mock.lastCall as unknown[] | undefined)?.[0]).toMatchObject({
      where: {
        AND: expect.arrayContaining([
          {
            serviceDate: {
              gte: new Date('2026-11-23T00:00:00.000Z'),
              lte: new Date('2026-11-29T00:00:00.000Z'),
            },
          },
        ]) as unknown,
      },
    });
  });
});
