import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  FAVORITE_ENTITY_TYPES,
  VIEW_KEYS,
  favoriteEntityTypeSchema,
  favoritesInputSchema,
  type FavoriteEntityType,
} from '@garita/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { viewCatalogFor } from '../view-preferences/view-access';
import { FavoritesService } from './favorites.service';

function entityType(raw: string): FavoriteEntityType {
  const parsed = favoriteEntityTypeSchema.safeParse(raw);
  if (!parsed.success) throw new NotFoundException('Tipo de elemento no encontrado');
  return parsed.data;
}

@ApiTags('Favoritos')
@ApiBearerAuth()
@Roles('admin', 'supervisor', 'client')
@Controller('mis-favoritos/:vista/:tipo')
@ApiParam({ name: 'vista', enum: VIEW_KEYS })
@ApiParam({ name: 'tipo', enum: FAVORITE_ENTITY_TYPES })
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista los elementos fijados de la pantalla, en orden' })
  get(
    @Param('vista') vista: string,
    @Param('tipo') tipo: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.favorites.get(viewCatalogFor(vista, user), entityType(tipo), user);
  }

  @Put()
  @ApiOperation({ summary: 'Reemplaza los elementos fijados de la pantalla y su orden' })
  put(
    @Param('vista') vista: string,
    @Param('tipo') tipo: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const catalog = viewCatalogFor(vista, user);
    const type = entityType(tipo);
    const parsed = favoritesInputSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.favorites.put(catalog, type, parsed.data.ids, user);
  }
}
