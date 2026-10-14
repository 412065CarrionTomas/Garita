import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { checkpointRecordRequestSchema } from '@garita/shared';
import { AllowDeactivatedFieldEvent, CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CheckpointRecordsService } from './checkpoint-records.service';

@ApiTags('Registros de puntos')
@ApiBearerAuth()
@Controller('registros-puntos')
export class CheckpointRecordsController {
  constructor(private readonly checkpointRecordsService: CheckpointRecordsService) {}

  @Post()
  @Roles('guard')
  @AllowDeactivatedFieldEvent()
  @ApiOperation({
    summary: 'Registra el paso por un punto de control escaneando su QR o leyendo NFC',
  })
  @ApiBody({ schema: { type: 'object' } })
  @ApiResponse({
    status: 200,
    description: 'Resultado del procesamiento (recorded, rejected o not_generated)',
  })
  @ApiResponse({ status: 400, description: 'Datos del registro no válidos' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Rol o estado no permitido' })
  @ApiResponse({ status: 404, description: 'Turno no encontrado' })
  @ApiConflictResponse({ description: 'Turno no en curso o conflicto de recordId' })
  record(@Body() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = checkpointRecordRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException('Los datos enviados no son válidos');
    }
    return this.checkpointRecordsService.processRecord(parsed.data, user);
  }
}
