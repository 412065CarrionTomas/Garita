import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { connectionNoticeRequestSchema, type ConnectionNoticeResponse } from '@garita/shared';
import { Public } from '../auth/auth.decorators';
import { ShiftCredentialGuard } from './shift-credential.guard';
import { CurrentShiftCredential } from './sync.decorators';
import type { ShiftCredentialPayload } from './shift-credential.service';
import { ShiftSyncStateService } from './shift-sync-state.service';

@ApiTags('Avisos de conexión')
@ApiBearerAuth()
@Controller('avisos-conexion')
export class ConnectionNoticesController {
  constructor(private readonly syncStateService: ShiftSyncStateService) {}

  @Post()
  @Public()
  @UseGuards(ShiftCredentialGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Registra un aviso periódico de conexión del celular con pendientes y hora sincronizada',
  })
  @ApiBody({ schema: { type: 'object' } })
  @ApiResponse({ status: 200, description: 'Aviso registrado correctamente' })
  @ApiResponse({ status: 400, description: 'Datos del aviso de conexión no válidos' })
  @ApiResponse({ status: 401, description: 'Credencial de turno inválida o vencida' })
  @ApiResponse({ status: 409, description: 'El turno del aviso no coincide con la credencial' })
  async notice(
    @Body() raw: unknown,
    @CurrentShiftCredential() credential: ShiftCredentialPayload,
  ): Promise<ConnectionNoticeResponse> {
    const parsed = connectionNoticeRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException('Datos del aviso de conexión no válidos');
    }
    if (parsed.data.shiftId !== credential.shiftId) {
      throw new ConflictException({
        code: 'SHIFT_ID_MISMATCH',
        message: 'El turno del aviso no coincide con la credencial',
      });
    }
    return this.syncStateService.recordNotice(
      credential.companyId,
      credential.shiftId,
      parsed.data,
    );
  }
}
