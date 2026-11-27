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
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    nfcTag: { updateMany: jest.fn() },
  };
  const prisma = {
    tenantPrisma: { ...db, $transaction: (action: (tx: typeof db) => unknown) => action(db) },
  } as unknown as PrismaService;
  const resources = { findOwnedOrThrow: jest.fn() } as unknown as TenantResourceService;
  const usage = {
    findActiveRoundsUsing: jest.fn().mockResolvedValue([]),
    countActiveRoundsBySite: jest.fn().mockResolvedValue(new Map<string, number>()),
  };
  return {
    db,
    usage,
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
describe('arrange', () => {
  const site = { latitude: { toNumber: () => -31.35 }, longitude: { toNumber: () => -64.29 } };
  const at = (id: string) => ({
    id,
    latitude: { toNumber: () => -31.35 },
    longitude: { toNumber: () => -64.29 },
    nfcTags: [],
  });
  function arrangeSetup() {
    const { db, service } = setup();
    db.checkpoint.findMany.mockResolvedValue([at('a'), at('b')]);
    (service as unknown as { sites: unknown }).sites = {
      assertSiteIsActive: jest.fn().mockResolvedValue(site),
    };
    return { db, service };
  }
  const point = (id: string, latitude = -31.35) => ({ id, latitude, longitude: -64.29 });

  it('numera los puntos en el orden recibido', async () => {
    const { db, service } = arrangeSetup();
    await service.arrange('site', { puntos: [point('b'), point('a')] }, user);
    expect(db.checkpoint.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'b', siteId: 'site', status: 'active' },
      data: { position: 1, latitude: -31.35, longitude: -64.29 },
    });
    expect(db.checkpoint.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'a', siteId: 'site', status: 'active' },
      data: { position: 2, latitude: -31.35, longitude: -64.29 },
    });
  });

  it('rechaza si un punto se dio de baja entre la lectura y la escritura', async () => {
    const { db, service } = arrangeSetup();
    db.checkpoint.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await expect(
      service.arrange('site', { puntos: [point('a'), point('b')] }, user),
    ).rejects.toMatchObject({ status: 409 });
  });

  it.each([[[point('a')]], [[point('a'), point('a')]], [[point('a'), point('x')]]])(
    'rechaza una lista que no es la de los puntos activos %#',
    async (puntos) => {
      const { db, service } = arrangeSetup();
      await expect(service.arrange('site', { puntos }, user)).rejects.toMatchObject({
        status: 409,
      });
      expect(db.checkpoint.updateMany).not.toHaveBeenCalled();
    },
  );

  it('pide confirmar un punto movido a más de 1 km', async () => {
    const { db, service } = arrangeSetup();
    const puntos = [point('a', -31.4), point('b')];
    await expect(service.arrange('site', { puntos }, user)).rejects.toMatchObject({
      status: 409,
    });
    expect(db.checkpoint.updateMany).not.toHaveBeenCalled();
    await service.arrange('site', { puntos, confirmFarLocation: true }, user);
    expect(db.checkpoint.updateMany).toHaveBeenCalledTimes(2);
  });
});

it('lista cada punto con sus rondas activas y cómo se marca', async () => {
  const { db, usage, service } = setup();
  db.checkpoint.findMany.mockResolvedValue([
    { id: 'a', nfcTags: [] },
    { id: 'b', nfcTags: [{ kind: 'basic' }] },
    { id: 'c', nfcTags: [{ kind: 'secure' }] },
  ]);
  usage.countActiveRoundsBySite.mockResolvedValue(new Map([['b', 2]]));
  const points = await service.list('site');
  expect(points.map(({ id, roundsCount, tagType }) => [id, roundsCount, tagType])).toEqual([
    ['a', 0, 'qr'],
    ['b', 2, 'nfc_basic'],
    ['c', 0, 'nfc_secure'],
  ]);
  expect(points[0]).not.toHaveProperty('etiquetaNfc');
});
