import { Injectable } from '@nestjs/common';
import type { FavoriteEntityType } from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Qué entidades de una lista existen, están activas y el usuario autenticado puede ver. */
export interface FavoriteVisibilityPort {
  visibleIds(type: FavoriteEntityType, ids: readonly string[]): Promise<Set<string>>;
}

export const FAVORITE_VISIBILITY_PORT = Symbol('FAVORITE_VISIBILITY_PORT');

/**
 * Lee con el cliente por empresa, que ya limita al supervisor a sus predios: un favorito nunca
 * revela una entidad que el usuario no vería en su listado.
 */
@Injectable()
export class PrismaFavoriteVisibilityAdapter implements FavoriteVisibilityPort {
  constructor(private readonly prisma: PrismaService) {}

  async visibleIds(type: FavoriteEntityType, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const where = { id: { in: [...ids] } };
    const select = { id: true } as const;
    const db = this.prisma.tenantPrisma;
    const rows =
      type === 'site'
        ? await db.site.findMany({ where: { ...where, status: 'active' }, select })
        : type === 'client'
          ? await db.client.findMany({ where: { ...where, status: 'active' }, select })
          : await db.user.findMany({
              where: { ...where, role: 'guard', status: 'active' },
              select,
            });
    return new Set(rows.map((row) => row.id));
  }
}
