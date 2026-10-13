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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  create(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = shiftInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.shifts.create(parsed.data, user);
  }

  @Patch('turnos/:id')
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Edita un turno antes de su inicio' })
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = shiftInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.shifts.update(id, parsed.data, user);
  }

  @Post('turnos/:id/cancelar')
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Cancela un turno antes de su inicio' })
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
