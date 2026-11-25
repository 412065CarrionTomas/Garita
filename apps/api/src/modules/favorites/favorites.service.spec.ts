import { BadRequestException } from '@nestjs/common';
import { adminSummaryCatalog, defineViewCatalog } from '@garita/shared';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import type { FavoriteVisibilityPort } from './favorites-visibility.port';
import { FavoritesService } from './favorites.service';

const admin: AuthenticatedUser = {
  userId: 'me',
  companyId: 'norte',
  role: 'admin',
  status: 'active',
};

function setup(visible: string[]) {
  const favorites = {
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const visibleIds = jest.fn((_type: string, ids: readonly string[]) =>
    Promise.resolve(new Set(ids.filter((id) => visible.includes(id)))),
  );
  const visibility: FavoriteVisibilityPort = { visibleIds };
  const tenantPrisma = {
    userFavorite: favorites,
    $transaction: (work: (tx: unknown) => Promise<unknown>) => work({ userFavorite: favorites }),
  };
  const service = new FavoritesService({ tenantPrisma } as unknown as PrismaService, visibility);
  return { favorites, service, visibleIds };
}

describe('FavoritesService', () => {
  it('devuelve los fijados en orden y omite los que ya no se ven', async () => {
    const { favorites, service } = setup(['b', 'a']);
    favorites.findMany.mockResolvedValue([
      { entityId: 'b' },
      { entityId: 'oculto' },
      { entityId: 'a' },
    ]);
    expect(await service.get(adminSummaryCatalog, 'site', admin)).toEqual({ ids: ['b', 'a'] });
    expect(favorites.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'me', viewKey: 'admin-summary', entityType: 'site' },
        orderBy: { position: 'asc' },
      }),
    );
  });

  it('reemplaza la lista guardando la posición de cada uno', async () => {
    const { favorites, service } = setup(['a', 'b']);
    expect(await service.put(adminSummaryCatalog, 'site', ['b', 'a'], admin)).toEqual({
      ids: ['b', 'a'],
    });
    const scope = { userId: 'me', viewKey: 'admin-summary', entityType: 'site' };
    expect(favorites.deleteMany).toHaveBeenCalledWith({ where: scope });
    expect(favorites.createMany).toHaveBeenCalledWith({
      data: [
        { ...scope, companyId: 'norte', entityId: 'b', position: 0 },
        { ...scope, companyId: 'norte', entityId: 'a', position: 1 },
      ],
    });
  });

  it('vaciar la lista no llama a createMany', async () => {
    const { favorites, service } = setup([]);
    await service.put(adminSummaryCatalog, 'site', [], admin);
    expect(favorites.deleteMany).toHaveBeenCalled();
    expect(favorites.createMany).not.toHaveBeenCalled();
  });

  it('reintenta si otra escritura concurrente del mismo ámbito chocó', async () => {
    const { favorites, service } = setup(['a']);
    favorites.createMany.mockRejectedValueOnce({ code: 'P2034' });
    await service.put(adminSummaryCatalog, 'site', ['a'], admin);
    expect(favorites.createMany).toHaveBeenCalledTimes(2);
  });

  it('no deja fijar lo que el usuario no puede ver', async () => {
    const { favorites, service } = setup(['a']);
    await expect(service.put(adminSummaryCatalog, 'site', ['a', 'ajeno'], admin)).rejects.toThrow(
      BadRequestException,
    );
    expect(favorites.deleteMany).not.toHaveBeenCalled();
  });

  it('no deja fijar tipos que la pantalla no ofrece', async () => {
    const onlySites = defineViewCatalog({
      key: 'admin-summary',
      version: 1,
      columns: 4,
      roles: ['admin'],
      favoriteTypes: ['site'],
      widgets: {
        one: {
          title: 'Uno',
          size: { min: { w: 1, h: 1 }, max: { w: 4, h: 4 }, default: { w: 1, h: 1 } },
          presentations: ['table'],
          settings: z.object({}),
        },
      },
      defaultLayout: [{ id: 'one', x: 0, y: 0 }],
    });
    const { service, visibleIds } = setup(['g']);
    await expect(service.put(onlySites, 'guard', ['g'], admin)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.get(onlySites, 'guard', admin)).rejects.toThrow(BadRequestException);
    expect(visibleIds).not.toHaveBeenCalled();
  });
});
