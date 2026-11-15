import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  portalQuerySchema,
  portalListQuerySchema,
  portalDayQuerySchema,
  portalSitesSchema,
  portalRoundsSchema,
  portalDaySchema,
  portalIncidentsSchema,
  portalPhotosSchema,
  portalEmergenciesSchema,
} from '@garita/shared';
import { parseOrBadRequest } from '../../common/parse-or-bad-request';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PortalService } from './portal.service';

@ApiTags('Portal del cliente')
@ApiBearerAuth()
@Roles('client')
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('predios')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Predios activos del cliente autenticado' })
  @ApiOkResponse({ standardSchema: portalSitesSchema })
  sites(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    parseOrBadRequest(z.strictObject({}), raw);
    return this.portal.sites(user);
  }

  @Get('rondas')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Cumplimiento sin datos internos. Período local [desde, hasta), máximo 12 meses; por defecto último mes.',
  })
  @ApiQuery({ name: 'desde', required: false })
  @ApiQuery({ name: 'hasta', required: false })
  @ApiQuery({ name: 'predio', required: false })
  @ApiOkResponse({ standardSchema: portalRoundsSchema })
  rounds(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.portal.rounds(parseOrBadRequest(portalQuerySchema, raw), user);
  }

  @Get('rondas/dia')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Horarios y estados visibles de un día local' })
  @ApiQuery({ name: 'fecha', required: true })
  @ApiQuery({ name: 'predio', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiOkResponse({ standardSchema: portalDaySchema })
  day(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.portal.day(parseOrBadRequest(portalDayQuerySchema, raw), user);
  }

  @Get('incidentes')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Incidentes visibles con la última nota para el cliente. Período local [desde, hasta), máximo 12 meses.',
  })
  @ApiQuery({ name: 'desde', required: false })
  @ApiQuery({ name: 'hasta', required: false })
  @ApiQuery({ name: 'predio', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiOkResponse({ standardSchema: portalIncidentsSchema })
  incidents(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.portal.incidents(parseOrBadRequest(portalListQuerySchema, raw), user);
  }

  @Get('incidentes/:id/fotos')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Enlaces privados firmados por cinco minutos; incidente no visible o ajeno responde 404',
  })
  @ApiOkResponse({ standardSchema: portalPhotosSchema })
  photos(@Param('id') id: string, @Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    parseOrBadRequest(z.strictObject({}), raw);
    return this.portal.incidentPhotos(parseOrBadRequest(z.string().min(1).max(100), id), user);
  }

  @Get('emergencias')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Emergencias reales resueltas y tiempo hasta confirmación. Período local [desde, hasta), máximo 12 meses.',
  })
  @ApiQuery({ name: 'desde', required: false })
  @ApiQuery({ name: 'hasta', required: false })
  @ApiQuery({ name: 'predio', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiOkResponse({ standardSchema: portalEmergenciesSchema })
  emergencies(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.portal.emergencies(parseOrBadRequest(portalListQuerySchema, raw), user);
  }
}
