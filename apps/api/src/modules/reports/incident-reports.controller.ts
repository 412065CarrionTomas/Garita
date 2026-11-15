import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  incidentReportQuerySchema,
  incidentReportDetailQuerySchema,
  panicReportDetailQuerySchema,
  incidentReportResponseSchema,
  incidentReportDetailResponseSchema,
  responseTimesReportSchema,
  panicReportResponseSchema,
  panicReportDetailResponseSchema,
} from '@garita/shared';
import { parseOrBadRequest } from '../../common/parse-or-bad-request';
import { Roles, CurrentUser } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { IncidentReportsService } from './incident-reports.service';

@ApiTags('Reportes de incidentes y respuesta')
@ApiBearerAuth()
@Roles('admin', 'supervisor')
@ApiQuery({
  name: 'desde',
  required: false,
  description: 'Inicio local YYYY-MM-DD; ambos extremos juntos, hasta 12 meses',
})
@ApiQuery({
  name: 'hasta',
  required: false,
  description: 'Fin local excluido YYYY-MM-DD; por defecto último mes',
})
@ApiQuery({ name: 'predio', required: false })
@ApiQuery({ name: 'cliente', required: false })
@Controller('reportes')
export class IncidentReportsController {
  constructor(private readonly reports: IncidentReportsService) {}
  @Get('incidentes')
  @ApiOperation({
    summary:
      'Incidentes por tipo, franja local de dos horas, predio y clasificación; pendientes y antigüedad',
  })
  @ApiOkResponse({ standardSchema: incidentReportResponseSchema })
  incidents(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.incidents(parseOrBadRequest(incidentReportQuerySchema, raw), user);
  }
  @Get('incidentes/detalle')
  @ApiOperation({ summary: 'Incidentes del segmento, paginados en la base' })
  @ApiQuery({ name: 'tipo', required: false })
  @ApiQuery({ name: 'franja', required: false, description: 'Hora inicial par: 0, 2, …, 22' })
  @ApiQuery({
    name: 'clasificacion',
    required: false,
    enum: ['pending', 'client_visible', 'internal'],
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ standardSchema: incidentReportDetailResponseSchema })
  detail(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.incidentDetail(
      parseOrBadRequest(incidentReportDetailQuerySchema, raw),
      user,
    );
  }
  @Get('tiempos-de-respuesta')
  @ApiOperation({
    summary:
      'Promedio, máximo, sin respuesta y escaladas desde envío, aviso o recepción; comparación solo para administrador',
  })
  @ApiOkResponse({ standardSchema: responseTimesReportSchema })
  responseTimes(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.responseTimes(parseOrBadRequest(incidentReportQuerySchema, raw), user);
  }
  @Get('panico')
  @ApiOperation({
    summary: 'Pánico por resultado y canal; sin resolver y proporción de falsas alarmas',
  })
  @ApiOkResponse({ standardSchema: panicReportResponseSchema })
  panic(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.panic(parseOrBadRequest(incidentReportQuerySchema, raw), user);
  }
  @Get('panico/detalle')
  @ApiOperation({ summary: 'Alertas del segmento, paginadas en la base' })
  @ApiQuery({
    name: 'resultado',
    required: false,
    enum: ['real_emergency', 'false_alarm', 'test', 'unresolved'],
  })
  @ApiQuery({ name: 'canal', required: false, enum: ['internet', 'sms'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ standardSchema: panicReportDetailResponseSchema })
  panicDetail(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.panicDetail(parseOrBadRequest(panicReportDetailQuerySchema, raw), user);
  }
}
