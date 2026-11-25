import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  VIEW_KEYS,
  VIEW_PREFERENCE_NO_BASE,
  viewPreferenceBaseSchema,
  viewPreferenceInputSchema,
} from '@garita/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { viewCatalogFor } from './view-access';
import { ViewPreferencesService } from './view-preferences.service';

@ApiTags('Preferencias de vista')
@ApiBearerAuth()
@Roles('admin', 'supervisor', 'client')
@Controller('mis-preferencias/vistas/:vista')
@ApiParam({ name: 'vista', enum: VIEW_KEYS })
export class ViewPreferencesController {
  constructor(private readonly preferences: ViewPreferencesService) {}

  @Get()
  @ApiOperation({
    summary: 'Devuelve el diseño propio de la pantalla, o null si usa el de defecto',
  })
  get(@Param('vista') vista: string, @CurrentUser() user: AuthenticatedUser) {
    return this.preferences.get(viewCatalogFor(vista, user), user);
  }

  @Put()
  @ApiOperation({ summary: 'Guarda el diseño propio de la pantalla; 409 si cambió mientras tanto' })
  put(@Param('vista') vista: string, @Body() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    const catalog = viewCatalogFor(vista, user);
    const parsed = viewPreferenceInputSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.preferences.put(catalog, parsed.data, user);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Restablece la pantalla al diseño por defecto; 409 si cambió desde baseUpdatedAt',
  })
  @ApiQuery({
    name: 'baseUpdatedAt',
    required: false,
    description: 'Fecha del diseño editado, o "null" si no había ninguno guardado',
  })
  async reset(
    @Param('vista') vista: string,
    @Query('baseUpdatedAt') rawBase: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const catalog = viewCatalogFor(vista, user);
    // Sin parámetro (clientes viejos) restablece sin control optimista.
    if (rawBase === undefined) return this.preferences.reset(catalog, user);
    const base = viewPreferenceBaseSchema.safeParse(
      rawBase === VIEW_PREFERENCE_NO_BASE ? null : rawBase,
    );
    if (!base.success) throw new BadRequestException(base.error.issues);
    await this.preferences.reset(catalog, user, base.data);
  }
}
