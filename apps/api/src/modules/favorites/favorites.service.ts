import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import type { FavoriteEntityType, FavoritesResponse, ViewCatalog } from '@garita/shared';
import { isPrismaError } from '../../common/prisma-errors';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { FAVORITE_VISIBILITY_PORT, type FavoriteVisibilityPort } from './favorites-visibility.port';

const MAX_ATTEMPTS = 3;

/** Espera creciente con azar: dos reintentos del mismo choque no vuelven a chocar a la par. */
const backoff = (attempt: number) =>
  new Promise((resolve) => setTimeout(resolve, 25 * attempt + Math.random() * 25));

/** Entidades fijadas arriba de las listas de una pantalla, en el orden que eligió el usuario. */
@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FAVORITE_VISIBILITY_PORT) private readonly visibility: FavoriteVisibilityPort,
  ) {}

  /** Omite las que se desactivaron o dejaron de ser visibles, sin borrarlas: pueden volver. */
  async get(
    catalog: ViewCatalog,
    type: FavoriteEntityType,
    user: AuthenticatedUser,
  ): Promise<FavoritesResponse> {
    this.assertType(catalog, type);
    const rows = await this.prisma.tenantPrisma.userFavorite.findMany({
      where: { userId: user.userId, viewKey: catalog.key, entityType: type },
      orderBy: { position: 'asc' },
      select: { entityId: true },
    });
    const ids = rows.map((row) => row.entityId);
    const visible = await this.visibility.visibleIds(type, ids);
    return { ids: ids.filter((id) => visible.has(id)) };
  }

  /** Reemplaza la lista completa: el orden del arreglo es el orden en pantalla. */
  async put(
    catalog: ViewCatalog,
    type: FavoriteEntityType,
    ids: readonly string[],
    user: AuthenticatedUser,
  ): Promise<FavoritesResponse> {
    this.assertType(catalog, type);
    const visible = await this.visibility.visibleIds(type, ids);
    if (ids.some((id) => !visible.has(id)))
      throw new BadRequestException('Hay elementos que no existen o que no podés ver.');
    const scope = { userId: user.userId, viewKey: catalog.key, entityType: type };
    const data = ids.map((entityId, position) => ({
      ...scope,
      companyId: user.companyId,
      entityId,
      position,
    }));
    // Serializable: dos reemplazos concurrentes del mismo ámbito chocarían (P2002) o mezclarían listas.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.prisma.tenantPrisma.$transaction(
          async (tx) => {
            await tx.userFavorite.deleteMany({ where: scope });
            if (data.length > 0) await tx.userFavorite.createMany({ data });
          },
          { isolationLevel: 'Serializable' },
        );
        break;
      } catch (error) {
        if (!isPrismaError(error, 'P2034', 'P2002')) throw error;
        if (attempt >= MAX_ATTEMPTS)
          throw new ConflictException(
            'Los fijados cambiaron a la vez desde otro lado. Probá de nuevo.',
          );
        await backoff(attempt);
      }
    }
    return { ids: [...ids] };
  }

  private assertType(catalog: ViewCatalog, type: FavoriteEntityType) {
    if (!catalog.favoriteTypes.includes(type))
      throw new BadRequestException('Esta pantalla no permite fijar ese tipo de elemento.');
  }
}
