import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { viewCatalogs, viewKeySchema, type ViewCatalog } from '@garita/shared';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Catálogo de la pantalla pedida, si el rol del usuario puede verla. Lo comparten las preferencias
 * de vista y los favoritos: los dos se guardan por pantalla y con las mismas reglas de acceso.
 */
export function viewCatalogFor(rawViewKey: string, user: AuthenticatedUser): ViewCatalog {
  const parsed = viewKeySchema.safeParse(rawViewKey);
  if (!parsed.success) throw new NotFoundException('Pantalla no encontrada');
  const catalog = viewCatalogs[parsed.data];
  if (!catalog.roles.includes(user.role))
    throw new ForbiddenException('Tu rol no puede personalizar esta pantalla');
  return catalog;
}
