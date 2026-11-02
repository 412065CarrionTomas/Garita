import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { notificationPreferencesSchema } from '@garita/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NotificationPreferencesService } from './notification-preferences.service';

const preferencesBody = {
  type: 'object' as const,
  required: ['shift_not_started'],
  additionalProperties: false,
  properties: { shift_not_started: { type: 'boolean' as const, default: true } },
};
@ApiTags('Preferencias de notificaci�n')
@ApiBearerAuth()
@Roles('admin', 'supervisor')
@Controller('mis-preferencias/notificaciones')
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferencesService) {}
  @Get()
  @ApiOperation({ summary: 'Consulta las preferencias personales; push activada por defecto' })
  @ApiOkResponse({ schema: preferencesBody })
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.preferences.get(user);
  }
  @Put()
  @ApiOperation({ summary: 'Guarda �nicamente las preferencias del usuario autenticado' })
  @ApiBody({ schema: preferencesBody })
  @ApiOkResponse({ schema: preferencesBody })
  put(@Body() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = notificationPreferencesSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.preferences.put(parsed.data, user);
  }
}
