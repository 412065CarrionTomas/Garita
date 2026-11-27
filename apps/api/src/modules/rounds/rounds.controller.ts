import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  guardRoundVersionsQuerySchema,
  previewRoundSchema,
  roundInputSchema,
  roundRoutePreviewInputSchema,
} from '@garita/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RoundsService } from './rounds.service';

@Controller()
@ApiTags('rondas')
@ApiBearerAuth()
export class RoundsController {
  constructor(private readonly rounds: RoundsService) {}

  @Get('rondas/versiones')
  @Roles('guard')
  @ApiOperation({ summary: 'Versiones de ronda del vigilador, con puntos en orden y recorrido' })
  @ApiQuery({ name: 'ids', description: 'Ids de versión separados por coma (hasta 20)' })
  versionsForGuard(@Query() query: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = guardRoundVersionsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.rounds.versionsForGuard(parsed.data.ids, user);
  }
  @Get('predios/:id/rondas')
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  list(@Param('id') id: string) {
    return this.rounds.list(id);
  }
  @Post('predios/:id/rondas')
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409 })
  @ApiResponse({ status: 422, description: 'Secciones sin calcular; reenviar con allowStraight' })
  create(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = roundInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.rounds.create(id, parsed.data, user);
  }
  @Patch('rondas/:id')
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409 })
  @ApiResponse({ status: 422, description: 'Secciones sin calcular; reenviar con allowStraight' })
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = roundInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.rounds.update(id, parsed.data, user);
  }
  @Post('rondas/:id/baja')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.rounds.deactivate(id, user);
  }
  @Post('rondas/previsualizar-ventanas')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  preview(@Body() body: unknown) {
    const parsed = previewRoundSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.rounds.preview(parsed.data);
  }
  @Post('rondas/ruteo-previsualizar')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  previewRoute(@Body() body: unknown) {
    const parsed = roundRoutePreviewInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.rounds.previewRoute(parsed.data);
  }
}
