import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { graceRetryRequestSchema } from '@garita/shared';
import { parseOrBadRequest } from '../../common/parse-or-bad-request';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { GraceService } from './grace.service';

@ApiTags('Gracia de la suscripción')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Sin sesión' })
@ApiResponse({ status: 403, description: 'Solo administradores' })
@Controller({ path: 'suscripcion', version: '1' })
export class GraceController {
  constructor(private readonly grace: GraceService) {}
  @Get('medio-de-pago')
  @Roles('admin')
  @ApiOperation({
    summary: 'Portal de Mercado Pago para cambiar el medio de pago de la suscripción',
  })
  @ApiResponse({ status: 200, description: 'URL del portal de Suscripciones de Mercado Pago' })
  @ApiResponse({ status: 404, description: 'Sin suscripción abierta propia' })
  paymentMethod(@CurrentUser() user: AuthenticatedUser) {
    return this.grace.paymentMethod(user.companyId);
  }
  @Post('reintentar-cobro')
  @HttpCode(200)
  @Roles('admin')
  @ApiOperation({
    summary: 'Devuelve el enlace de Checkout Pro para regularizar el ciclo en gracia',
  })
  @ApiResponse({
    status: 200,
    description: 'initPoint y expiresAt; reutiliza la preferencia vigente sin pago iniciado',
  })
  @ApiResponse({
    status: 409,
    description: 'Sin gracia vigente, cobro en proceso o pago único pendiente',
  })
  retry(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    parseOrBadRequest(graceRetryRequestSchema, body ?? {});
    return this.grace.retry(user.companyId);
  }
}
