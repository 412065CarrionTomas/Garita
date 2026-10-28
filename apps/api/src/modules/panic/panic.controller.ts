import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { createPanicAlertRequestSchema, updatePanicLocationRequestSchema } from '@garita/shared';
import { z } from 'zod';
import { Public } from '../auth/auth.decorators';
import { CurrentShiftCredential } from '../sync/sync.decorators';
import { ShiftCredentialGuard } from '../sync/shift-credential.guard';
import type { ShiftCredentialPayload } from '../sync/shift-credential.service';
import { PanicService } from './panic.service';

@ApiTags('Alertas de pánico')
@ApiBearerAuth()
@Controller('alertas-panico')
@Public()
@UseGuards(ShiftCredentialGuard)
@ApiResponse({ status: 401, description: 'Credencial de turno ausente o inválida' })
@ApiResponse({ status: 404, description: 'Alerta ajena o inexistente' })
export class PanicController {
  constructor(private readonly panic: PanicService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Registra una alerta de pánico del turno o una nueva activación' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['alertId', 'shiftId', 'occurredAtDevice', 'location'],
      properties: {
        alertId: { type: 'string', format: 'uuid' },
        shiftId: { type: 'string' },
        occurredAtDevice: { type: 'string', format: 'date-time' },
        clock: { type: 'object', description: 'DeviceClock de HU-14' },
        location: {
          type: 'object',
          description:
            'FieldLocation: status, latitude, longitude, accuracyMeters, simulation y takenAt',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Estado registrado, también ante un UUID repetido' })
  @ApiResponse({ status: 403, description: 'Credencial de otro turno o asignación no vigente' })
  @ApiResponse({ status: 409, description: 'El turno no está en curso' })
  create(@Body() raw: unknown, @CurrentShiftCredential() credential: ShiftCredentialPayload) {
    const body = createPanicAlertRequestSchema.safeParse(raw);
    if (!body.success) throw new BadRequestException('Alerta de pánico no válida');
    return this.panic.create(body.data, credential);
  }

  @Patch(':alertId/ubicacion')
  @ApiOperation({ summary: 'Actualiza la ubicación de una alerta propia' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['location'],
      properties: {
        location: {
          type: 'object',
          description: 'FieldLocation con una precisión mejor que la registrada',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Estado de la misma alerta después de actualizar la ubicación',
  })
  updateLocation(
    @Param('alertId') rawId: string,
    @Body() raw: unknown,
    @CurrentShiftCredential() credential: ShiftCredentialPayload,
  ) {
    const alertId = z.uuid().safeParse(rawId);
    const body = updatePanicLocationRequestSchema.safeParse(raw);
    if (!alertId.success || !body.success) throw new BadRequestException('Ubicación no válida');
    return this.panic.updateLocation(alertId.data, body.data, credential);
  }

  @Get(':alertId/estado')
  @ApiOperation({ summary: 'Consulta el estado confirmado de una alerta propia' })
  @ApiResponse({
    status: 200,
    description:
      'alertId, status (active, confirmed, resolved), receivedAt y confirmedAt (fecha o null)',
  })
  state(
    @Param('alertId') rawId: string,
    @CurrentShiftCredential() credential: ShiftCredentialPayload,
  ) {
    const alertId = z.uuid().safeParse(rawId);
    if (!alertId.success) throw new BadRequestException('Identificador no válido');
    return this.panic.state(alertId.data, credential);
  }
}
