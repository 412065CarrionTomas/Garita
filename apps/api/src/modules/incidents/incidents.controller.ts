import { BadRequestException, Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentShiftCredential } from '../sync/sync.decorators';
import { ShiftCredentialGuard } from '../sync/shift-credential.guard';
import type { ShiftCredentialPayload } from '../sync/shift-credential.service';
import { IncidentsService } from './incidents.service';
import { Public } from '../auth/auth.decorators';

const photoRegistrationSchema = z.object({ publicId: z.string().min(1).max(512) }).strict();

@ApiTags('Incidentes')
@ApiBearerAuth()
@Controller('incidentes')
@Public()
@UseGuards(ShiftCredentialGuard)
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Post(':id/fotos/autorizacion')
  @ApiOperation({ summary: 'Autoriza una foto privada de un incidente propio del turno' })
  authorizePhoto(
    @Param('id') id: string,
    @CurrentShiftCredential() credential: ShiftCredentialPayload,
  ) {
    return this.incidents.authorizePhoto(id, credential);
  }

  @Post(':id/fotos')
  @ApiOperation({ summary: 'Registra una foto privada ya subida a Cloudinary' })
  async registerPhoto(
    @Param('id') id: string,
    @Body() raw: unknown,
    @CurrentShiftCredential() credential: ShiftCredentialPayload,
  ) {
    const body = photoRegistrationSchema.safeParse(raw);
    if (!body.success) throw new BadRequestException('Identificador de foto no válido');
    return this.incidents.registerPhoto(id, credential, body.data.publicId);
  }
}
