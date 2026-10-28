import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { closeShiftRequestSchema, startShiftRequestSchema } from '@garita/shared';
import {
  AllowDeactivatedFieldEvent,
  AllowPendingInvitation,
  CurrentUser,
  Roles,
} from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
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
  start(@Param('id') id: string, @Body() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.execution.start(id, startShiftRequestSchema.parse(raw), user);
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
    return this.execution.close(id, closeShiftRequestSchema.parse(raw), user);
  }
}
