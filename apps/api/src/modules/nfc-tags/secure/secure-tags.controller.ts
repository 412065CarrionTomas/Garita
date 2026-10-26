import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  secureTagCommandSchema,
  secureTagConfirmSchema,
  secureTagStartSchema,
} from '@garita/shared';
import { CurrentUser, Roles } from '../../auth/auth.decorators';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { SecureTagsService } from './secure-tags.service';

@Controller()
@ApiTags('etiquetas NFC seguras')
@ApiBearerAuth()
export class SecureTagsController {
  constructor(private readonly secure: SecureTagsService) {}

  @Post('puntos/:id/etiqueta-segura/configuracion')
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 201, description: 'Sesión iniciada y primer APDU generado.' })
  @ApiResponse({ status: 401, description: 'Falta autenticación.' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso.' })
  @ApiResponse({ status: 404, description: 'Punto no disponible.' })
  @ApiResponse({ status: 422, description: 'Etiqueta no disponible.' })
  @ApiResponse({ status: 503, description: 'Clave maestra no configurada.' })
  start(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = secureTagStartSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Datos de etiqueta inválidos');
    return this.secure.start(id, parsed.data, user);
  }

  @Post('etiquetas-seguras/configuracion/:session/comando')
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 201, description: 'Próximo APDU o lectura de prueba.' })
  @ApiResponse({ status: 401, description: 'Falta autenticación.' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso.' })
  @ApiResponse({ status: 404, description: 'Sesión no disponible.' })
  command(
    @Param('session') session: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const parsed = secureTagCommandSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Respuesta NFC inválida');
    return this.secure.command(session, parsed.data.response, user);
  }

  @Post('etiquetas-seguras/configuracion/:session/confirmar')
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 201, description: 'Lectura SUN verificada y etiqueta asociada.' })
  @ApiResponse({ status: 401, description: 'Falta autenticación.' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso.' })
  @ApiResponse({ status: 404, description: 'Sesión no disponible.' })
  confirm(
    @Param('session') session: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const parsed = secureTagConfirmSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Lectura de prueba inválida');
    return this.secure.confirm(session, parsed.data, user);
  }

  @Post('etiquetas-seguras/:id/restablecer')
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 201, description: 'Etiqueta retirada lista para reasociar.' })
  @ApiResponse({ status: 401, description: 'Falta autenticación.' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso.' })
  @ApiResponse({ status: 404, description: 'Etiqueta no disponible.' })
  reset(@Param('id') id: string) {
    return this.secure.reset(id);
  }
}
