import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  incidentClassificationSchema,
  incidentListQuerySchema,
  incidentReclassificationSchema,
} from '@garita/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { IncidentClassificationService } from './incident-classification.service';

const queueQuerySchema = z.object({ predio: z.string().min(1).optional() }).strict();
const incidentIdSchema = z.string().min(1).max(100);

function parseId(raw: string) {
  const parsed = incidentIdSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException('Identificador de incidente no válido');
  return parsed.data;
}

@ApiTags('Incidentes')
@ApiBearerAuth()
@Controller('incidentes')
@Roles('admin', 'supervisor')
export class IncidentClassificationController {
  constructor(private readonly classification: IncidentClassificationService) {}

  @Get('cola/cantidad')
  @ApiOperation({ summary: 'Cuenta incidentes pendientes asignados al usuario' })
  count(@CurrentUser() user: AuthenticatedUser) {
    return this.classification.queueCount(user);
  }

  @Get('cola')
  @ApiOperation({ summary: 'Lista incidentes pendientes del más antiguo al más reciente' })
  @ApiQuery({ name: 'predio', required: false })
  queue(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = queueQuerySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.classification.queue(user, parsed.data.predio);
  }

  @Get()
  @ApiOperation({ summary: 'Lista incidentes con filtros y paginación' })
  @ApiQuery({ name: 'predio', required: false })
  @ApiQuery({ name: 'desde', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'hasta', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'tipo', required: false })
  @ApiQuery({ name: 'clasificacion', required: false })
  @ApiQuery({ name: 'pagina', required: false, type: Number })
  list(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = incidentListQuerySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    if (parsed.data.desde && parsed.data.hasta && parsed.data.desde > parsed.data.hasta)
      throw new BadRequestException('La fecha inicial debe ser anterior a la final');
    return this.classification.list(user, parsed.data);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Devuelve incidente, fotos firmadas e historial' })
  detail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.classification.detail(parseId(id), user);
  }

  @Post(':id/clasificar')
  @ApiOperation({ summary: 'Clasifica un incidente pendiente' })
  classify(@Param('id') id: string, @Body() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = incidentClassificationSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.classification.decide(parseId(id), user, parsed.data);
  }

  @Post(':id/reclasificar')
  @ApiOperation({ summary: 'Reclasifica un incidente y conserva el historial' })
  reclassify(
    @Param('id') id: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const parsed = incidentReclassificationSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.classification.decide(parseId(id), user, parsed.data);
  }
}
