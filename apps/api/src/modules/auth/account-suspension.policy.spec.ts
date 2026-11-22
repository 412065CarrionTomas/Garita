import {
  enforceAccountSuspension,
  suspensionClassification,
  SUSPENSION_ENDPOINTS,
} from './account-suspension.policy';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import { SUSPENSION_MESSAGES, USER_ROLES } from '@garita/shared';

const now = new Date('2030-12-09T00:00:00Z');
const suspendedAt = new Date('2030-12-08T23:00:00Z');
function setup(path: string, method = 'GET', role: AuthenticatedUser['role'] = 'supervisor') {
  const shift = {
    id: 'shift',
    status: 'in_progress',
    startedAt: new Date('2030-12-08T22:00:00Z'),
    endsAt: new Date('2030-12-09T06:00:00Z'),
    closedAt: null,
    closedWithoutDataAt: null,
    syncDeadlineAt: new Date('2030-12-09T08:00:00Z'),
    syncState: null,
  };
  const db = {
    shift: {
      findMany: jest.fn().mockResolvedValue([shift]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    shiftAssignment: { updateMany: jest.fn() },
    panicAlert: { findMany: jest.fn().mockResolvedValue([{ id: 'panic' }]) },
    notice: { findFirst: jest.fn().mockResolvedValue({ id: 'notice' }) },
  };
  const user: AuthenticatedUser = {
    userId: 'supervisor',
    companyId: 'company',
    role,
    status: 'active',
  };
  const req = {
    method,
    route: { path: `/api/v1/${path}` },
    params: {
      id: path.startsWith('avisos') ? 'notice' : path.startsWith('alertas') ? 'panic' : 'shift',
    },
  } as unknown as AuthenticatedRequest;
  const run = (status = 'suspended') =>
    enforceAccountSuspension(
      { tenantPrisma: db } as unknown as PrismaService,
      req,
      user,
      { accountStatus: status, suspendedAt },
      now,
    );
  return { shift, db, user, req, run };
}

describe('HU-43 policy', () => {
  it.each(USER_ROLES)('denies unlisted routes with the exact %s message', async (role) => {
    await expect(setup('usuarios', 'GET', role).run()).rejects.toMatchObject({
      status: 402,
      response: {
        code: 'ACCOUNT_SUSPENDED',
        accountStatus: 'suspended',
        message: SUSPENSION_MESSAGES[role],
      },
    });
  });
  it('new routes are blocked and declared exceptions are classified', () => {
    expect(suspensionClassification('POST', 'shift-schedules')).toBe('blocked');
    for (const [route, classification] of Object.entries(SUSPENSION_ENDPOINTS)) {
      const [method, path] = route.split(' ');
      if (!method || !path) throw new Error('Invalid declared route');
      expect(suspensionClassification(method, path)).toBe(classification);
    }
  });
  it('active accounts need no additional query', async () => {
    const f = setup('usuarios');
    await f.run('active');
    expect(f.db.shift.findMany).not.toHaveBeenCalled();
  });
  it('rejects a new start and cancels only its unstarted assignment', async () => {
    const f = setup('turnos/:id/iniciar', 'POST', 'guard');
    await expect(f.run()).rejects.toMatchObject({ status: 402 });
    expect(f.db.shift.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'shift',
          status: { in: ['scheduled', 'unassigned'] },
          startedAt: null,
          assignments: { some: { guardId: f.user.userId, isCurrent: true, active: true } },
        },
        data: { status: 'cancelled_by_suspension' },
      }),
    );
    // V9 H2: el turno reclamado libera su asignación.
    expect(f.db.shiftAssignment.updateMany).toHaveBeenCalledWith({
      where: { shiftId: 'shift', active: true },
      data: { active: false },
    });
  });
  it('keeps a started shift and the guard close enabled', async () => {
    await expect(setup('turnos/:id/cerrar', 'POST', 'guard').run()).resolves.toBeUndefined();
  });
  it('expires shift access after closure and complete sync', async () => {
    const f = setup('turnos/:id/detalle');
    Object.assign(f.shift, {
      status: 'closed',
      closedAt: now,
      syncState: { syncedUntil: now, lastPendingCount: 0 },
    });
    await expect(f.run()).rejects.toMatchObject({ status: 402 });
  });
  it('allows close without data before deadline and denies it after deadline', async () => {
    const f = setup('turnos/:id/cerrar-sin-datos', 'POST');
    await expect(f.run()).resolves.toBeUndefined();
    f.shift.syncDeadlineAt = now;
    await expect(f.run()).rejects.toMatchObject({ status: 402 });
  });
  it('denies a shift invisible to the tenant/site filter', async () => {
    const f = setup('turnos/:id/detalle');
    f.db.shift.findMany.mockResolvedValue([]);
    await expect(f.run()).rejects.toMatchObject({ status: 402 });
  });
  it('keeps unresolved panic attention after the sync deadline', async () => {
    const f = setup('alertas-panico/:id/resolver', 'POST');
    f.shift.syncDeadlineAt = now;
    await expect(f.run()).resolves.toBeUndefined();
    f.db.panicAlert.findMany.mockResolvedValue([]);
    await expect(f.run()).rejects.toMatchObject({ status: 402 });
  });
});
