import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { shiftInputSchema } from '@garita/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ShiftsService } from './shifts.service';

const listQuerySchema = z.object({
  predio: z.string().optional(),
  vigilador: z.string().optional(),
  desde: z.iso.datetime({ offset: true }).optional(),
  hasta: z.iso.datetime({ offset: true }).optional(),
  sinVigilador: z.enum(['true', 'false']).optional(),
});

@ApiTags('Turnos')
@ApiBearerAuth()
@Controller()
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get('turnos')
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Lista turnos de la empresa con filtros opcionales' })
  @ApiQuery({ name: 'predio', required: false, type: String })
  @ApiQuery({ name: 'vigilador', required: false, type: String })
  @ApiQuery({ name: 'desde', required: false, type: String, format: 'date-time' })
  @ApiQuery({ name: 'hasta', required: false, type: String, format: 'date-time' })
  @ApiQuery({ name: 'sinVigilador', required: false, enum: ['true', 'false'] })
  list(@Query() query: unknown) {
    const parsed = listQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.shifts.list(parsed.data);
  }

  @Get('turnos/:id')
  @Roles('admin', 'supervisor', 'guard')
  @ApiOperation({ summary: 'Consulta el detalle de un turno propio o visible por rol' })
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.shifts.get(id, user);
  }

  @Post('turnos')
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Crea un turno y su primera asignación' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['siteId', 'guardId', 'startsAt', 'endsAt', 'roundIds'],
      properties: {
        siteId: { type: 'string' },
        guardId: { type: 'string', nullable: true },
        startsAt: { type: 'string', format: 'date-time' },
        endsAt: { type: 'string', format: 'date-time' },
        roundIds: { type: 'array', minItems: 1, items: { type: 'string' } },
      },
    },
  })
  @ApiConflictResponse({
    description: 'El vigilador ya tiene un turno superpuesto; incluye el turno en conflicto',
  })
  create(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = shiftInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.shifts.create(parsed.data, user);
  }

  @Patch('turnos/:id')
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Edita un turno antes de su inicio' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['siteId', 'guardId', 'startsAt', 'endsAt', 'roundIds'],
      properties: {
        siteId: { type: 'string' },
        guardId: { type: 'string', nullable: true },
        startsAt: { type: 'string', format: 'date-time' },
        endsAt: { type: 'string', format: 'date-time' },
        roundIds: { type: 'array', minItems: 1, items: { type: 'string' } },
      },
    },
  })
  @ApiConflictResponse({
    description: 'Turno superpuesto o inicio ya pasado (SHIFT_OVERLAP / SHIFT_STARTED)',
  })
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = shiftInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.shifts.update(id, parsed.data, user);
  }

  @Post('turnos/:id/cancelar')
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Cancela un turno antes de su inicio' })
  @ApiConflictResponse({
    description: 'El turno ya comenzó; solo se puede reasignar (SHIFT_STARTED)',
  })
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.shifts.cancel(id, user);
  }

  @Get('mis-turnos')
  @Roles('guard')
  @ApiOperation({ summary: 'Lista los próximos 14 días del vigilador autenticado' })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.shifts.mine(user);
  }

  @Get('usuarios/:id/turnos-futuros')
  @Roles('admin')
  @ApiOperation({ summary: 'Lista los turnos futuros de un vigilador' })
  futureForUser(@Param('id') id: string) {
    return this.shifts.futureForUser(id);
  }
}
