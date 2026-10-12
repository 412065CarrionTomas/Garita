import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { checkpointInputSchema, checkpointListQuerySchema } from '@garita/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CheckpointsService } from './checkpoints.service';

@Controller()
export class CheckpointsController {
  constructor(private readonly checkpoints: CheckpointsService) {}

  @Get('predios/:id/puntos')
  @Roles('admin', 'supervisor')
  list(@Param('id') siteId: string) {
    return this.checkpoints.list(siteId);
  }

  @Post('predios/:id/puntos')
  @Roles('admin')
  create(
    @Param('id') siteId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const input = checkpointInputSchema.safeParse(body);
    if (!input.success) throw new BadRequestException('Los datos enviados no son válidos');
    return this.checkpoints.create(siteId, input.data, user);
  }

  @Patch('puntos/:id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const input = checkpointInputSchema.safeParse(body);
    if (!input.success) throw new BadRequestException('Los datos enviados no son válidos');
    return this.checkpoints.update(id, input.data, user);
  }

  @Post('puntos/:id/baja')
  @Roles('admin')
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.checkpoints.deactivate(id, user);
  }

  @Post('puntos/:id/regenerar-qr')
  @Roles('admin')
  regenerateQr(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.checkpoints.regenerateQr(id, user);
  }

  @Get('predios/:id/stickers')
  @Roles('admin')
  @Header('Content-Type', 'application/pdf')
  async stickers(@Param('id') siteId: string, @Query() query: unknown, @Res() response: Response) {
    const parsed = checkpointListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('La lista de puntos no es válida');
    const pdf = await this.checkpoints.createStickerPdf(siteId, parsed.data.puntos);
    response.setHeader('Content-Disposition', 'attachment; filename="stickers-puntos.pdf"');
    response.end(pdf);
  }
}
