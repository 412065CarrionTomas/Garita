import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  reconcileLayout,
  validateLayout,
  VIEW_PREFERENCE_CONFLICT_CODE,
  type ViewCatalog,
  type ViewLayout,
  type ViewPreferenceInput,
  type ViewPreferenceResponse,
} from '@garita/shared';
import { Prisma } from '../../generated/prisma/client';
import { isPrismaError } from '../../common/prisma-errors';
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
    // Se guardan los ajustes ya parseados por cada bloque: descarta claves que el bloque no declara.
    const sanitized: ViewLayout = {
      ...input.layout,
      items: input.layout.items.map((item) => ({
        ...item,
        settings: catalog.widgets[item.id]?.settings.parse(item.settings) ?? {},
      })),
    };
    const layout = sanitized as unknown as Prisma.InputJsonValue;
    const where = { userId: user.userId, viewKey: catalog.key };
    if (input.baseUpdatedAt === null) {
      try {
        const row = await this.prisma.tenantPrisma.userViewPreference.create({
          data: { ...where, companyId: user.companyId, version: catalog.version, layout },
          select: { updatedAt: true },
        });
        return { layout: sanitized, updatedAt: row.updatedAt.toISOString() };
      } catch (error) {
        if (isPrismaError(error, 'P2002')) throw conflict();
        throw error;
      }
    }
    // Escribe y lee en una sola consulta: un DELETE concurrente no puede colarse entre ambas.
    const [row] = await this.prisma.tenantPrisma.userViewPreference.updateManyAndReturn({
      where: { ...where, updatedAt: new Date(input.baseUpdatedAt) },
      data: { version: catalog.version, layout },
      select: { updatedAt: true },
    });
    if (!row) throw conflict();
    return { layout: sanitized, updatedAt: row.updatedAt.toISOString() };
  }

  /**
   * Restablecer: sin fila, la pantalla vuelve al diseño por defecto. Con `baseUpdatedAt` solo
   * borra si nadie guardó desde entonces; si otra pestaña ya lo borró, el resultado es el mismo.
   */
  async reset(
    catalog: ViewCatalog,
    user: AuthenticatedUser,
    baseUpdatedAt?: string,
  ): Promise<void> {
    const where = { userId: user.userId, viewKey: catalog.key };
    const { count } = await this.prisma.tenantPrisma.userViewPreference.deleteMany({
      where: baseUpdatedAt ? { ...where, updatedAt: new Date(baseUpdatedAt) } : where,
    });
    if (count > 0 || !baseUpdatedAt) return;
    const remaining = await this.prisma.tenantPrisma.userViewPreference.findFirst({
      where,
      select: { updatedAt: true },
    });
    if (remaining) throw conflict();
  }
}
