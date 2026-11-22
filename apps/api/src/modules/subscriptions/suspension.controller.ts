import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { payOverdueRequestSchema } from '@garita/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { parseOrBadRequest } from '../../common/parse-or-bad-request';
import { SuspensionService } from './suspension.service';

@ApiTags('Suscripción')
@ApiBearerAuth()
@Controller('suscripcion')
@Roles('admin')
export class SuspensionController {
  constructor(private readonly suspension: SuspensionService) {}
  @Post('pagar-adeudado')
  @ApiOperation({ summary: 'Paga el ciclo completo rechazado sin cambiar el próximo cobro' })
  @ApiResponse({
    status: 409,
    description: 'Sin deuda o falta elegir los vigiladores del plan menor',
  })
  pay(@Body() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.suspension.pay(parseOrBadRequest(payOverdueRequestSchema, raw), user);
  }
}
