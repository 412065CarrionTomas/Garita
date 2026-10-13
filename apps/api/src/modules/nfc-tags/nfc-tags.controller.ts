import { BadRequestException, Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { associateNfcTagSchema } from '@garita/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NfcTagsService } from './nfc-tags.service';

@Controller()
@ApiTags('etiquetas NFC')
@ApiBearerAuth()
export class NfcTagsController {
  constructor(private readonly tags: NfcTagsService) {}

  @Get('configuracion/predios')
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 200, description: 'Predios disponibles para configurar.' })
  @ApiResponse({ status: 401, description: 'Falta autenticación.' })
  @ApiResponse({ status: 403, description: 'El rol no puede configurar etiquetas.' })
  sites(@CurrentUser() user: AuthenticatedUser) {
    return this.tags.configurationSites(user);
  }

  @Put('puntos/:id/etiqueta-nfc')
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 200, description: 'Etiqueta asociada al punto.' })
  @ApiResponse({ status: 400, description: 'UID inválido.' })
  @ApiResponse({ status: 401, description: 'Falta autenticación.' })
  @ApiResponse({ status: 403, description: 'El usuario no puede configurar este predio.' })
  @ApiResponse({ status: 404, description: 'Punto inexistente.' })
  @ApiResponse({
    status: 409,
    description: 'Se requiere confirmar el movimiento o hubo una colisión.',
  })
  @ApiResponse({ status: 422, description: 'La etiqueta no está disponible para esta empresa.' })
  associate(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const parsed = associateNfcTagSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('El identificador NFC no es válido');
    return this.tags.associate(id, parsed.data, user);
  }

  @Delete('puntos/:id/etiqueta-nfc')
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 200, description: 'Etiqueta quitada del punto.' })
  @ApiResponse({ status: 401, description: 'Falta autenticación.' })
  @ApiResponse({ status: 403, description: 'El usuario no puede configurar este predio.' })
  @ApiResponse({ status: 404, description: 'Punto o etiqueta activa inexistente.' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tags.remove(id, user);
  }
}
