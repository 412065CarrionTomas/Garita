import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  panicAlertsQuerySchema,
  resolvePanicAlertRequestSchema,
  PANIC_OUTCOMES,
  PANIC_STATUSES,
} from '@garita/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PanicAttentionService } from './panic-attention.service';

function parseId(raw: string) {
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) throw new BadRequestException('Identificador de alerta no válido');
  return parsed.data;
}

@ApiTags('Atención de pánico')
@ApiBearerAuth()
@Controller('alertas-panico')
@Roles('admin', 'supervisor')
@ApiResponse({ status: 401, description: 'Token Firebase ausente o inválido' })
@ApiResponse({ status: 403, description: 'Rol no permitido' })
@ApiResponse({ status: 404, description: 'Alerta ajena, predio no asignado o inexistente' })
export class PanicAttentionController {
  constructor(private readonly attention: PanicAttentionService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista alertas visibles, de más nueva a más vieja, y cantidad de activas',
  })
  @ApiQuery({ name: 'estado', required: false, enum: PANIC_STATUSES })
  @ApiQuery({ name: 'predio', required: false })
  @ApiQuery({ name: 'pagina', required: false, type: Number })
  list(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = panicAlertsQuerySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.attention.list(parsed.data, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de atención, horas, ubicación y estados de SMS' })
  detail(@Param('id') id: string) {
    return this.attention.detail(parseId(id));
  }

  @Post(':id/confirmar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirma una alerta activa y registra autor y hora' })
  @ApiResponse({
    status: 409,
    description: 'Ya confirmada o resuelta, incluso por el mismo usuario',
  })
  confirm(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.attention.confirm(parseId(id), user);
  }

  @Post(':id/resolver')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Resuelve una alerta confirmada, aunque la haya confirmado otra persona',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['outcome', 'comment'],
      properties: {
        outcome: { type: 'string', enum: [...PANIC_OUTCOMES] },
        comment: { type: 'string', minLength: 5, maxLength: 1000 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Resultado o comentario inválidos' })
  @ApiResponse({ status: 409, description: 'Primero confirmá la alerta' })
  resolve(@Param('id') id: string, @Body() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = resolvePanicAlertRequestSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.attention.resolve(parseId(id), user, parsed.data);
  }
}
