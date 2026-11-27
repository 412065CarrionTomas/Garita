import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  reportQuerySchema,
  reportDetailQuerySchema,
  reportPendingQuerySchema,
  reportPointsQuerySchema,
  reportResponseSchema,
  reportDetailResponseSchema,
  reportPendingResponseSchema,
  reportPointsResponseSchema,
  siteDayGridQuerySchema,
  siteDayGridResponseSchema,
} from '@garita/shared';
import { Roles, CurrentUser } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ReportsService } from './reports.service';

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new BadRequestException(result.error.issues);
  return result.data;
}
@ApiTags('Reportes de cumplimiento')
@ApiBearerAuth()
@Roles('admin', 'supervisor')
@Controller('reportes')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get('rondas')
  @ApiOperation({
    summary:
      'Calcula cumplimiento, estados, evolución y comparaciones. Período local [desde, hasta), por defecto último mes.',
  })
  @ApiQuery({ name: 'desde', required: false, type: String, example: '2026-10-01' })
  @ApiQuery({ name: 'hasta', required: false, type: String, example: '2026-11-01' })
  @ApiQuery({ name: 'predio', required: false })
  @ApiQuery({ name: 'cliente', required: false })
  @ApiQuery({
    name: 'vigilador',
    required: false,
    description: 'ID del vigilador o unassigned para sin vigilador',
  })
  @ApiOkResponse({
    standardSchema: reportResponseSchema,
  })
  report(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.report(parse(reportQuerySchema, raw), user);
  }

  @Get('rondas/casilleros')
  @ApiOperation({
    summary:
      'Cumplimiento de cada predio día por día (casilleros). Período local [desde, hasta) de hasta 31 días.',
  })
  @ApiQuery({ name: 'desde', required: true, type: String, example: '2026-11-10' })
  @ApiQuery({ name: 'hasta', required: true, type: String, example: '2026-11-24' })
  @ApiQuery({ name: 'predio', required: false })
  @ApiQuery({ name: 'cliente', required: false })
  @ApiOkResponse({ standardSchema: siteDayGridResponseSchema })
  siteDayGrid(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.siteDayGrid(parse(siteDayGridQuerySchema, raw), user);
  }

  @Get('rondas/detalle')
  @ApiOperation({
    summary: 'Lista las ventanas de un segmento con turno, ronda, predio y dueño histórico',
  })
  @ApiQuery({ name: 'desde', required: false })
  @ApiQuery({ name: 'hasta', required: false })
  @ApiQuery({ name: 'predio', required: false })
  @ApiQuery({ name: 'cliente', required: false })
  @ApiQuery({ name: 'vigilador', required: false })
  @ApiQuery({ name: 'estado', required: false })
  @ApiQuery({ name: 'dia', required: false, description: 'Fecha local YYYY-MM-DD' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({
    name: 'orden',
    required: false,
    enum: ['asc', 'desc'],
    description: 'Orden cronológico; asc por defecto',
  })
  @ApiOkResponse({
    standardSchema: reportDetailResponseSchema,
  })
  detail(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.detail(parse(reportDetailQuerySchema, raw), user);
  }

  @Get('pendientes')
  @ApiOperation({ summary: 'Cuenta pendientes visibles y su fecha más antigua o próxima' })
  @ApiQuery({ name: 'predio', required: false })
  @ApiOkResponse({
    standardSchema: reportPendingResponseSchema,
  })
  pending(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.pending(parse(reportPendingQuerySchema, raw), user);
  }

  @Get('puntos-marcas-frecuentes')
  @ApiOperation({
    summary: 'Diez puntos con mayor proporción de marcas, mínimo tres registros marcados válidos',
  })
  @ApiQuery({ name: 'desde', required: false })
  @ApiQuery({ name: 'hasta', required: false })
  @ApiQuery({ name: 'predio', required: false })
  @ApiOkResponse({
    standardSchema: reportPointsResponseSchema,
  })
  points(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.points(parse(reportPointsQuerySchema, raw), user);
  }
}
