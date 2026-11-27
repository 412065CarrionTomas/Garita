import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  shiftScheduleInputSchema,
  shiftScheduleDefinitionSchema,
  shiftSchedulePatchSchema,
  shiftScheduleExtensionSchema,
  shiftScheduleQuerySchema,
  SCHEDULE_LIST_STATES,
} from '@garita/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { parseOrBadRequest } from '../../common/parse-or-bad-request';
import { ShiftSchedulesService } from './shift-schedules.service';
import { z } from 'zod';

const scheduleBody = {
  type: 'object' as const,
  properties: {
    siteId: { type: 'string' as const },
    guardId: { type: 'string' as const },
    weekdays: {
      type: 'array' as const,
      items: { type: 'integer' as const, minimum: 0, maximum: 6 },
      minItems: 1,
    },
    startTime: { type: 'string' as const, example: '22:00' },
    endTime: { type: 'string' as const, example: '06:00' },
    roundIds: { type: 'array' as const, items: { type: 'string' as const }, minItems: 1 },
    startDate: { type: 'string' as const, format: 'date' },
    endDate: { type: 'string' as const, format: 'date' },
  },
};

@ApiTags('Programaciones de turnos')
@ApiBearerAuth()
@Roles('admin', 'supervisor')
@Controller('programaciones-turnos')
export class ShiftSchedulesController {
  constructor(private readonly schedules: ShiftSchedulesService) {}
  @Get()
  @ApiOperation({
    summary: 'Lista programaciones con su vigencia y sus turnos; vigentes si no se pide estado',
  })
  @ApiQuery({ name: 'predio', required: false, type: String })
  @ApiQuery({ name: 'vigilador', required: false, type: String })
  @ApiQuery({ name: 'estado', required: false, enum: SCHEDULE_LIST_STATES })
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'pagina', required: false, type: Number })
  @ApiQuery({ name: 'porPagina', required: false, type: Number })
  list(@Query() query: unknown) {
    return this.schedules.list(parseOrBadRequest(shiftScheduleQuerySchema, query));
  }

  @Post('previsualizar')
  @ApiQuery({
    name: 'programacion',
    required: false,
    type: String,
    description: 'Programación propia a modificar; excluye sus turnos reemplazables',
  })
  @ApiOperation({ summary: 'Previsualiza turnos, conflictos y ventanas sin cubrir, sin persistir' })
  @ApiBody({ schema: scheduleBody })
  preview(@Body() body: unknown, @Query() query: unknown, @CurrentUser() user: AuthenticatedUser) {
    const { programacion } = parseOrBadRequest(
      z.strictObject({ programacion: z.string().min(1).optional() }),
      query,
    );
    const input = parseOrBadRequest(
      programacion ? shiftScheduleDefinitionSchema : shiftScheduleInputSchema,
      body,
    );
    return programacion
      ? this.schedules.previewEdit(programacion, input, user)
      : this.schedules.preview(input, user);
  }

  @Post()
  @ApiOperation({
    summary: 'Crea una programación y todos los turnos sin conflicto, de forma atómica',
  })
  @ApiBody({ schema: scheduleBody })
  create(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.schedules.create(parseOrBadRequest(shiftScheduleInputSchema, body), user);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Modifica y regenera solo turnos futuros sin modificaciones individuales',
  })
  @ApiBody({ schema: scheduleBody })
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.schedules.update(id, parseOrBadRequest(shiftSchedulePatchSchema, body), user);
  }

  @Post(':id/extender')
  @ApiOperation({
    summary: 'Extiende desde el día siguiente al fin actual, hasta tres meses adicionales',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['endDate'],
      properties: { endDate: { type: 'string', format: 'date' } },
    },
  })
  extend(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.schedules.extend(
      id,
      parseOrBadRequest(shiftScheduleExtensionSchema, body).endDate,
      user,
    );
  }

  @Post(':id/cancelar')
  @ApiOperation({
    summary: 'Cancela la programación y sus turnos futuros sin iniciar; conserva el historial',
  })
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.schedules.cancel(id, user);
  }
}
