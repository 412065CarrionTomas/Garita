import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiOperation,
  ApiTags,
  ApiResponse,
} from '@nestjs/swagger';
import {
  closeShiftRequestSchema,
  closeWithoutDataRequestSchema,
  startShiftRequestSchema,
} from '@garita/shared';
import {
  AllowDeactivatedFieldEvent,
  AllowPendingInvitation,
  CurrentUser,
  Roles,
} from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { parseOrBadRequest } from '../../common/parse-or-bad-request';
import { ShiftExecutionService } from './shift-execution.service';

@ApiTags('Ejecución de turnos')
@ApiBearerAuth()
@Controller('turnos/:id')
export class ShiftExecutionController {
  constructor(private readonly execution: ShiftExecutionService) {}
  @Post('iniciar')
  @Roles('guard')
  @AllowPendingInvitation()
  @ApiOperation({ summary: 'Inicia el turno y descarga sus datos sin conexión' })
  @ApiBody({ schema: { type: 'object' } })
  @ApiConflictResponse({ description: 'El turno no se puede iniciar' })
  @ApiResponse({
    status: 402,
    description: 'Cuenta suspendida: no se inician turnos nuevos',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', enum: ['ACCOUNT_SUSPENDED'] },
        accountStatus: { type: 'string', enum: ['suspended'] },
        message: { type: 'string' },
      },
    },
  })
  start(@Param('id') id: string, @Body() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.execution.start(id, parseOrBadRequest(startShiftRequestSchema, raw), user);
  }
  @Get('datos') @Roles('guard', 'supervisor') data(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.execution.data(id, user);
  }
  @Get('estado') @Roles('guard', 'supervisor') state(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.execution.state(id, user);
  }
  @Post('cerrar')
  @Roles('guard')
  @AllowDeactivatedFieldEvent()
  @ApiOperation({ summary: 'Cierra el turno desde la app del vigilador' })
  @ApiBody({ schema: { type: 'object' } })
  close(@Param('id') id: string, @Body() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.execution.close(id, parseOrBadRequest(closeShiftRequestSchema, raw), user);
  }

  @Post('cerrar-sin-datos')
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Cierra sin datos un turno con aviso de sincronización pendiente' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['reason'],
      properties: { reason: { type: 'string', minLength: 5, maxLength: 500 } },
    },
  })
  @ApiConflictResponse({ description: 'El turno no tiene un aviso de sincronización abierto' })
  closeWithoutData(
    @Param('id') id: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const parsed = closeWithoutDataRequestSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.execution.closeWithoutData(id, parsed.data.reason, user);
  }
}
