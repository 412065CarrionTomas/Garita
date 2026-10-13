import { BadRequestException, Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { associateNfcTagSchema } from '@garita/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NfcTagsService } from './nfc-tags.service';

@Controller()
export class NfcTagsController {
  constructor(private readonly tags: NfcTagsService) {}

  @Get('configuracion/predios')
  @Roles('admin', 'supervisor')
  sites(@CurrentUser() user: AuthenticatedUser) {
    return this.tags.configurationSites(user);
  }

  @Put('puntos/:id/etiqueta-nfc')
  @Roles('admin', 'supervisor')
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
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tags.remove(id, user);
  }
}
