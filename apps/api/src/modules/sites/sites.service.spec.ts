import { Logger } from '@nestjs/common';
import { SitesService } from './sites.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantResourceService } from '../auth/tenant-resource.service';
import type { ShiftExecutionService } from '../shift-execution/shift-execution.service';
import type { FirebaseIdentityProvider } from '../auth/auth.types';

function setup() {
  const shifts = [{ id: 'shift', assignments: [] }];
  const db = {
    site: {
      findMany: jest.fn().mockResolvedValue([{ id: 'site' }]),
      update: jest.fn().mockResolvedValue({ id: 'site' }),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    client: {
      update: jest.fn().mockResolvedValue({ id: 'client' }),
      count: jest.fn().mockResolvedValue(7),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([
        { id: 'u1', firebaseUid: 'f1' },
        { id: 'u2', firebaseUid: 'f2' },
      ]),
      updateMany: jest.fn(),
    },
    shift: {
      findMany: jest.fn<Promise<typeof shifts>, [{ where: unknown }]>().mockResolvedValue(shifts),
      count: jest.fn<Promise<number>, [{ where: unknown }]>().mockResolvedValue(3),
      updateMany: jest.fn(),
    },
    shiftAssignment: { updateMany: jest.fn() },
    siteSupervisor: { deleteMany: jest.fn() },
    invitation: { updateMany: jest.fn() },
    notificationDevice: { deleteMany: jest.fn() },
    nfcTag: { updateMany: jest.fn() },
  };
  let inTransaction = false;
  const prisma = {
    tenantPrisma: {
      ...db,
      $transaction: async (action: (tx: typeof db) => unknown) => {
        inTransaction = true;
        try {
          return await action(db);
        } finally {
          inTransaction = false;
        }
      },
    },
  } as unknown as PrismaService;
  const resources = {
    findOwnedOrThrow: jest
      .fn()
      .mockResolvedValue({ id: 'client', clientId: 'client', status: 'active' }),
  };
  const weekly = { countForSite: jest.fn().mockResolvedValue(0), terminateForSites: jest.fn() };
  const progress = { closeForSites: jest.fn() };
  const execution = { notifyGuardToLeaveAfterCommit: jest.fn() };
  const firebase = {
    setDisabled: jest.fn(() => {
      expect(inTransaction).toBe(false);
      return Promise.resolve();
    }),
    revokeRefreshTokens: jest.fn(() => {
      expect(inTransaction).toBe(false);
      return Promise.resolve();
    }),
  };
  const service = new SitesService(
    prisma,
    resources as unknown as TenantResourceService,
    { now: () => new Date('2026-11-13T12:00:00Z') },
    weekly,
    progress,
    execution as unknown as ShiftExecutionService,
    firebase as unknown as FirebaseIdentityProvider,
  );
  return { service, db, resources, firebase };
}
describe('SitesService audit regressions', () => {
  it('pagina clientes buscando cada palabra y no ordena por predios al supervisor', async () => {
    const { service, db } = setup();
    db.client.count.mockResolvedValueOnce(4).mockResolvedValueOnce(3);
    const page = await service.listClients(
      { buscar: ' ferreyra  peralta ', orden: 'predios', pagina: 2, porPagina: 5 },
      { role: 'supervisor', userId: 'sup' } as never,
    );
    const args = (db.client.findMany.mock.calls as unknown[][])[0]?.[0] as {
      where: { AND: { OR: object[] }[] };
      orderBy: object[];
      skip: number;
      take: number;
    };
    expect(args.where.AND).toHaveLength(2);
    expect(args.where.AND[1]?.OR).toContainEqual({
      contactName: { contains: 'peralta', mode: 'insensitive' },
    });
    expect(args.orderBy).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    expect(args).toMatchObject({ skip: 5, take: 5 });
    expect(page).toMatchObject({ total: 7, paginas: 2, resumen: { active: 4, inactive: 3 } });
  });

  it('ordena por predios descendente desempatando A–Z, y al supervisor solo por nombre', async () => {
    const { service, db } = setup();
    const query = { orden: 'predios', sentido: 'desc', pagina: 1, porPagina: 20 } as const;
    await service.listClients(query, { role: 'admin', userId: 'admin' } as never);
    await service.listClients(query, { role: 'supervisor', userId: 'sup' } as never);
    const orderBy = (call: number) =>
      ((db.client.findMany.mock.calls as unknown[][])[call]?.[0] as { orderBy: object[] }).orderBy;
    expect(orderBy(0)).toEqual([{ sites: { _count: 'desc' } }, { name: 'asc' }, { id: 'asc' }]);
    expect(orderBy(1)).toEqual([{ name: 'asc' }, { id: 'asc' }]);
  });

  it('impacto y cancelacion incluyen no iniciados vencidos y uncovered, y todos los in_progress', async () => {
    const { service, db } = setup();
    const impact = await service.impactSiteDeactivation('site');
    expect(impact).toMatchObject({ shiftsToCancel: 1, inProgressShiftsToClose: 3 });
    expect(db.shift.findMany.mock.calls[0]?.[0].where).toEqual({
      siteId: { in: ['site'] },
      status: { in: ['scheduled', 'unassigned', 'uncovered'] },
    });
    expect(db.shift.count.mock.calls[0]?.[0].where).toEqual({
      siteId: { in: ['site'] },
      status: 'in_progress',
    });
    await service.deactivateSite('site', true, 'admin');
    const cancelQuery = db.shift.findMany.mock.calls.at(-1)?.[0].where;
    expect(cancelQuery).toEqual({
      siteId: { in: ['site'] },
      status: { in: ['scheduled', 'unassigned', 'uncovered'] },
    });
    expect(db.shift.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'cancelled' }) as unknown,
      }),
    );
    expect(db.nfcTag.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { checkpoint: { siteId: { in: ['site'] } }, status: 'active' },
        data: expect.objectContaining({ status: 'removed', endedById: 'admin' }) as unknown,
      }),
    );
  });
  it('borra dispositivos y deshabilita/revoca cada usuario fuera de la transaccion aun ante falla parcial', async () => {
    const { service, db, firebase } = setup();
    firebase.setDisabled.mockRejectedValueOnce(new Error('Firebase unavailable'));
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    await service.deactivateClient('client', true, 'admin');
    expect(db.notificationDevice.deleteMany).toHaveBeenCalledWith({
      where: { user: { clientId: 'client' } },
    });
    expect(firebase.setDisabled).toHaveBeenCalledWith('f1', true);
    expect(firebase.setDisabled).toHaveBeenCalledWith('f2', true);
    expect(firebase.revokeRefreshTokens).toHaveBeenCalledWith('f1');
    expect(firebase.revokeRefreshTokens).toHaveBeenCalledWith('f2');
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'client_user_firebase_deactivation_failed',
        operation: 'disable',
        userId: 'u1',
      }),
    );
    expect(db.nfcTag.updateMany).toHaveBeenCalled();
  });
  it('rechaza alta y edicion bajo cliente inactivo', async () => {
    const { service, resources, db } = setup();
    resources.findOwnedOrThrow.mockResolvedValue({
      id: 'client',
      clientId: 'client',
      status: 'inactive',
    });
    await expect(
      service.createSite({
        clientId: 'client',
        companyId: 'c',
        name: 'Site',
        address: 'Street',
        latitude: -34,
        longitude: -58,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(service.updateSite('site', { name: 'Changed' })).rejects.toMatchObject({
      status: 409,
    });
    expect(db.site.create).not.toHaveBeenCalled();
    expect(db.site.update).not.toHaveBeenCalled();
  });
});
