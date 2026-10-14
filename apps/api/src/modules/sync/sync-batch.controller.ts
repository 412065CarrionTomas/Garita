import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { syncBatchRequestSchema, type SyncBatchResponse } from '@garita/shared';
import { CurrentUser, Public } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ShiftCredentialGuard } from './shift-credential.guard';
import { CurrentShiftCredential } from './sync.decorators';
import type { ShiftCredentialPayload } from './shift-credential.service';
import { SyncBatchService } from './sync-batch.service';

@ApiTags('Sincronización de eventos')
@ApiBearerAuth()
@Controller('sincronizacion')
export class SyncBatchController {
  constructor(private readonly syncBatchService: SyncBatchService) {}

  @Post('eventos')
  @Public()
  @UseGuards(ShiftCredentialGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sincroniza un lote de eventos registrados sin señal durante el turno',
  })
  @ApiBody({ schema: { type: 'object' } })
  @ApiResponse({
    status: 200,
    description: 'Lote procesado (cada evento con su estado: accepted, duplicate o rejected)',
  })
  @ApiResponse({ status: 400, description: 'Estructura del lote inválida' })
  @ApiResponse({ status: 401, description: 'Credencial de turno inválida o vencida' })
  @ApiResponse({ status: 409, description: 'El turno del lote no coincide con la credencial' })
  async syncBatch(
    @Body() raw: unknown,
    @CurrentShiftCredential() credential: ShiftCredentialPayload,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SyncBatchResponse> {
    const parsed = syncBatchRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException('Estructura del lote de eventos no válida');
    }
    return this.syncBatchService.processBatch(parsed.data, credential, user);
  }
}
