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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
export class PanicController {
  constructor(private readonly panic: PanicService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Registra una alerta de pánico del turno o una nueva activación' })
  create(@Body() raw: unknown, @CurrentShiftCredential() credential: ShiftCredentialPayload) {
    const body = createPanicAlertRequestSchema.safeParse(raw);
    if (!body.success) throw new BadRequestException('Alerta de pánico no válida');
    return this.panic.create(body.data, credential);
  }

  @Patch(':alertId/ubicacion')
  @ApiOperation({ summary: 'Actualiza la ubicación de una alerta propia' })
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
  state(
    @Param('alertId') rawId: string,
    @CurrentShiftCredential() credential: ShiftCredentialPayload,
  ) {
    const alertId = z.uuid().safeParse(rawId);
    if (!alertId.success) throw new BadRequestException('Identificador no válido');
    return this.panic.state(alertId.data, credential);
  }
}
