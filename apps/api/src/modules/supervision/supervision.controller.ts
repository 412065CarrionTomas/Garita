import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { recordFlagSeveritySchema } from '@garita/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SupervisionService } from './supervision.service';

const listQuerySchema = z.object({
  estado: z.string().optional(),
  predio: z.string().optional(),
  fecha: z.iso.date().optional(),
});
const detailQuerySchema = z.object({
  marcados: z.preprocess(
    (value) => (value === 'true' ? true : value === 'false' ? false : value),
    z.boolean().optional(),
  ),
  gravedad: recordFlagSeveritySchema.optional(),
});

@ApiTags('Supervisión')
@ApiBearerAuth()
@Controller()
export class SupervisionController {
  constructor(private readonly supervision: SupervisionService) {}

  @Get('supervision/turnos')
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Lista los turnos del día con su estado y resumen de sincronización' })
  @ApiQuery({ name: 'estado', required: false, type: String })
  @ApiQuery({ name: 'predio', required: false, type: String })
  @ApiQuery({ name: 'fecha', required: false, type: String, format: 'date' })
  list(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = listQuerySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.supervision.list(parsed.data, user);
  }

  @Get('turnos/:id/detalle')
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Devuelve el detalle de supervisión de un turno' })
  @ApiQuery({ name: 'marcados', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'gravedad', required: false, enum: ['grave', 'media', 'leve'] })
  detail(@Param('id') id: string, @Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = detailQuerySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.supervision.detail(id, user, parsed.data);
  }
}
