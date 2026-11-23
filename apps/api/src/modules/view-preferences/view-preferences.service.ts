import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  reconcileLayout,
  validateLayout,
  VIEW_PREFERENCE_CONFLICT_CODE,
  type ViewCatalog,
  type ViewPreferenceInput,
  type ViewPreferenceResponse,
} from '@garita/shared';
import { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

const conflict = () =>
  new ConflictException({
    code: VIEW_PREFERENCE_CONFLICT_CODE,
    message: 'El diseño cambió desde otra pestaña o dispositivo. Recargalo antes de guardar.',
  });

/** Diseño de bloques de cada pantalla, propio de cada usuario. */
@Injectable()
export class ViewPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lo guardado se reconcilia con el catálogo actual: un catálogo nuevo nunca rompe la pantalla. */
  async get(catalog: ViewCatalog, user: AuthenticatedUser): Promise<ViewPreferenceResponse> {
    const row = await this.prisma.tenantPrisma.userViewPreference.findFirst({
      where: { userId: user.userId, viewKey: catalog.key },
      select: { layout: true, updatedAt: true },
    });
    if (!row) return { layout: null, updatedAt: null };
    return { layout: reconcileLayout(catalog, row.layout), updatedAt: row.updatedAt.toISOString() };
  }

  /**
   * Guarda solo si nadie lo cambió desde `baseUpdatedAt` (control optimista): la condición va en
   * la misma escritura, así dos pestañas no se pisan aunque guarden a la vez.
   */
  async put(
    catalog: ViewCatalog,
    input: ViewPreferenceInput,
    user: AuthenticatedUser,
  ): Promise<ViewPreferenceResponse> {
    const issues = validateLayout(catalog, input.layout);
    if (issues.length) throw new BadRequestException({ message: 'Diseño inválido', issues });
    const layout = input.layout as unknown as Prisma.InputJsonValue;
    const where = { userId: user.userId, viewKey: catalog.key };
    if (input.baseUpdatedAt === null) {
      try {
        const row = await this.prisma.tenantPrisma.userViewPreference.create({
          data: { ...where, companyId: user.companyId, version: catalog.version, layout },
          select: { updatedAt: true },
        });
        return { layout: input.layout, updatedAt: row.updatedAt.toISOString() };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw conflict();
        throw error;
      }
    }
    const { count } = await this.prisma.tenantPrisma.userViewPreference.updateMany({
      where: { ...where, updatedAt: new Date(input.baseUpdatedAt) },
      data: { version: catalog.version, layout },
    });
    if (count === 0) throw conflict();
    const row = await this.prisma.tenantPrisma.userViewPreference.findFirstOrThrow({
      where,
      select: { updatedAt: true },
    });
    return { layout: input.layout, updatedAt: row.updatedAt.toISOString() };
  }

  /** Restablecer: sin fila, la pantalla vuelve al diseño por defecto. */
  async reset(catalog: ViewCatalog, user: AuthenticatedUser): Promise<void> {
    await this.prisma.tenantPrisma.userViewPreference.deleteMany({
      where: { userId: user.userId, viewKey: catalog.key },
    });
  }
}
