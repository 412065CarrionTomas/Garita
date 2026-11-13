import { CheckpointsService } from './checkpoints.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantResourceService } from '../auth/tenant-resource.service';
import type { SitesService } from '../sites/sites.service';
import type { QrService } from './qr.service';

const user = { userId: 'admin', companyId: 'c', role: 'admin' as const, status: 'active' as const };
function setup() {
  const db = {
    roundVersionCheckpoint: { findFirst: jest.fn().mockResolvedValue(null) },
    checkpoint: {
      update: jest.fn().mockResolvedValue({ id: 'point', status: 'inactive' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    nfcTag: { updateMany: jest.fn() },
  };
  const prisma = {
    tenantPrisma: { ...db, $transaction: (action: (tx: typeof db) => unknown) => action(db) },
  } as unknown as PrismaService;
  const resources = { findOwnedOrThrow: jest.fn() } as unknown as TenantResourceService;
  const usage = { findActiveRoundsUsing: jest.fn().mockResolvedValue([]) };
  return {
    db,
    service: new CheckpointsService(prisma, resources, {} as SitesService, {} as QrService, usage),
  };
}
it('rechaza baja de punto fijado en un turno en curso, aunque no tenga ronda activa', async () => {
  const { db, service } = setup();
  db.roundVersionCheckpoint.findFirst.mockResolvedValue({ id: 'pinned' });
  await expect(service.deactivate('point', user)).rejects.toMatchObject({ status: 409 });
  expect(db.checkpoint.update).not.toHaveBeenCalled();
  expect(db.nfcTag.updateMany).not.toHaveBeenCalled();
});
it('baja punto y retira etiquetas activas en una transaccion', async () => {
  const { db, service } = setup();
  await service.deactivate('point', user);
  expect(db.nfcTag.updateMany).toHaveBeenCalledWith({
    where: { checkpointId: 'point', status: 'active' },
    data: expect.objectContaining({ status: 'removed', endedById: 'admin' }) as unknown,
  });
  expect(db.checkpoint.update).toHaveBeenCalledWith({
    where: { id: 'point' },
    data: { status: 'inactive' },
  });
});
it.each([undefined, []])('rechaza PDF sin puntos %j', async (ids) => {
  const { service } = setup();
  await expect(service.createStickerPdf('site', ids)).rejects.toMatchObject({ status: 400 });
});
