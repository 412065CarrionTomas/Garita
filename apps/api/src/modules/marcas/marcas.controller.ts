import { BadRequestException, Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  recordFlagSeveritySchema,
  updateSiteSpeedSchema,
  type ShiftRecordsResponse,
} from '@garita/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { MarcasService } from './marcas.service';

const shiftRecordsQuerySchema = z.object({
  marcados: z.preprocess((val) => {
    if (val === 'true') return true;
    if (val === 'false') return false;
    return val;
  }, z.boolean().optional()),
  gravedad: z.preprocess((val) => {
    if (val === '' || val === undefined) return undefined;
    return val;
  }, recordFlagSeveritySchema.optional()),
});

@Controller()
@ApiTags('marcas')
@ApiBearerAuth()
export class MarcasController {
  constructor(private readonly marcas: MarcasService) {}

  @Get('turnos/:id/registros')
  @Roles('admin', 'supervisor')
  @ApiOperation({
    summary:
      'Obtiene los registros del turno con sus marcas sospechosas, motivos, gravedad y dato de celular sin NFC',
  })
  @ApiQuery({
    name: 'marcados',
    required: false,
    type: Boolean,
    description: 'Si es true, devuelve únicamente los registros con marcas',
  })
  @ApiQuery({
    name: 'gravedad',
    required: false,
    enum: ['grave', 'media', 'leve'],
    description: 'Filtra las marcas por nivel de gravedad',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de registros del turno con marcas y metadato de NFC del celular.',
  })
  @ApiResponse({ status: 401, description: 'Falta autenticación.' })
  @ApiResponse({ status: 403, description: 'El rol guard no tiene acceso a las marcas del turno.' })
  @ApiResponse({ status: 404, description: 'Turno no encontrado o no asignado al supervisor.' })
  async getShiftRecords(
    @Param('id') shiftId: string,
    @Query() rawQuery: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ShiftRecordsResponse> {
    const parsed = shiftRecordsQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException('Parámetros de consulta inválidos');
    }
    return this.marcas.getShiftRecords(
      shiftId,
      {
        marcados: parsed.data.marcados,
        gravedad: parsed.data.gravedad,
      },
      user,
    );
  }

  @Patch('predios/:id/recorrido')
  @Roles('admin', 'supervisor')
  @ApiOperation({
    summary: 'Configura el perfil de recorrido y velocidad máxima del predio (5 a 120 km/h)',
  })
  @ApiResponse({
    status: 200,
    description: 'Predio actualizado con su nuevo perfil y velocidad máxima.',
  })
  @ApiResponse({
    status: 400,
    description: 'Velocidad máxima inválida (debe estar entre 5 y 120 km/h).',
  })
  @ApiResponse({ status: 401, description: 'Falta autenticación.' })
  @ApiResponse({ status: 403, description: 'Sin permisos sobre el predio.' })
  @ApiResponse({ status: 404, description: 'Predio inexistente o no asignado.' })
  async updateSiteSpeed(
    @Param('id') siteId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const parsed = updateSiteSpeedSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Los datos de velocidad no son válidos',
      );
    }
    return this.marcas.updateSiteSpeed(siteId, parsed.data, user);
  }
}
