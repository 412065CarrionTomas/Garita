import { BadRequestException, Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiResponse, ApiTags } from '@nestjs/swagger';
import { registerDeviceRequestSchema } from '@garita/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';

@Controller('dispositivos')
@ApiTags('dispositivos de notificación')
@ApiBearerAuth()
export class DevicesController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post()
  @Roles('admin', 'supervisor', 'client', 'guard')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['token', 'kind', 'platform'],
      properties: {
        token: { type: 'string', maxLength: 4096 },
        kind: { type: 'string', enum: ['web', 'app'] },
        platform: { type: 'string', enum: ['android', 'ios', 'web'] },
        label: { type: 'string', maxLength: 80 },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Dispositivo registrado.' })
  @ApiResponse({ status: 400, description: 'Datos inválidos.' })
  register(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const input = registerDeviceRequestSchema.safeParse(body);
    if (!input.success) throw new BadRequestException('Los datos del dispositivo no son válidos');
    return this.notifications.register(input.data, user);
  }

  @Get()
  @Roles('admin', 'supervisor', 'client', 'guard')
  @ApiResponse({ status: 200, description: 'Dispositivos propios.' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.list(user);
  }

  @Delete(':id')
  @Roles('admin', 'supervisor', 'client', 'guard')
  @ApiResponse({ status: 200, description: 'Dispositivo eliminado.' })
  @ApiResponse({ status: 404, description: 'Dispositivo inexistente.' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.remove(id, user);
  }
}
