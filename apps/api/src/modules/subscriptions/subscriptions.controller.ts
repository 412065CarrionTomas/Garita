import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { cancelSubscriptionRequestSchema, createSubscriptionRequestSchema } from '@garita/shared';
import { parseOrBadRequest } from '../../common/parse-or-bad-request';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('Suscripción')
@ApiBearerAuth()
@Controller({ version: '1' })
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get('planes')
  @Roles('admin')
  @ApiOperation({ summary: 'Planes con su precio mensual y límite de vigiladores' })
  listPlans() {
    return this.subscriptions.listPlans();
  }

  @Post('suscripcion')
  @Roles('admin')
  @ApiOperation({ summary: 'Crea la suscripción y devuelve el enlace de Mercado Pago' })
  @ApiResponse({ status: 403, description: 'Solo administradores' })
  @ApiResponse({ status: 409, description: 'La empresa ya tiene una suscripción activa' })
  create(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.create(
      user.companyId,
      parseOrBadRequest(createSubscriptionRequestSchema, body),
    );
  }

  @Post('suscripcion/cancelar')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancela al fin del ciclo pagado; hasta entonces se puede revertir' })
  @ApiResponse({ status: 403, description: 'Solo administradores' })
  @ApiResponse({ status: 409, description: 'Ya estaba cancelada' })
  cancel(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const { reason } = parseOrBadRequest(cancelSubscriptionRequestSchema, body ?? {});
    return this.subscriptions.cancel(user.companyId, user.userId, reason);
  }

  @Post('suscripcion/revertir-cancelacion')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revierte una cancelación antes del fin del ciclo pagado' })
  @ApiResponse({ status: 403, description: 'Solo administradores' })
  @ApiResponse({ status: 409, description: 'El ciclo pagado ya terminó' })
  revertCancellation(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.revertCancellation(user.companyId);
  }

  @Get('suscripcion')
  @Roles('admin')
  @ApiOperation({ summary: 'Plan, estado, próximo cobro e historial de cobros' })
  @ApiResponse({ status: 403, description: 'Solo administradores' })
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.get(user.companyId);
  }
}
