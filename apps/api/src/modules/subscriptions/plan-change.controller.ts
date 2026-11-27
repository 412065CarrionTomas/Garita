import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { planChangeQuerySchema, planChangeRequestSchema } from '@garita/shared';
import { parseOrBadRequest } from '../../common/parse-or-bad-request';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PlanChangeService } from './plan-change.service';

@ApiTags('Suscripción')
@ApiBearerAuth()
@Roles('admin')
@Controller({ path: 'suscripcion', version: '1' })
export class PlanChangeController {
  constructor(private readonly changes: PlanChangeService) {}

  @Get('cambio-plan/simular')
  @ApiOperation({ summary: 'Simula importe y fecha del cambio sin llamar a Mercado Pago' })
  @ApiQuery({ name: 'plan', required: true, type: String })
  @ApiResponse({ status: 400, description: 'Plan vigente o consulta inválida' })
  simulate(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.changes.simulate(
      user.companyId,
      user.userId,
      parseOrBadRequest(planChangeQuerySchema, query).plan,
    );
  }

  @Post('cambio-plan')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cobra la subida o programa/reemplaza/anula una baja' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['planId'],
      properties: {
        planId: { type: 'string' },
        guardSelection: {
          type: 'object',
          description: 'Mismo contrato de elección de vigiladores de POST /suscripcion',
        },
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: 'Pago pendiente, ciclo no disponible o guard_selection_required',
  })
  change(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.changes.change(
      user.companyId,
      user.userId,
      parseOrBadRequest(planChangeRequestSchema, body),
    );
  }

  @Get('historial')
  @ApiOperation({ summary: 'Historial de cambios y pagos de diferencia de la empresa' })
  history() {
    return this.changes.history();
  }
}
