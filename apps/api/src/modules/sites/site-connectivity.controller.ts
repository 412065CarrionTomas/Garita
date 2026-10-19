import { BadRequestException, Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { connectivitySimulationQuerySchema, siteConnectivitySchema } from '@garita/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SiteConnectivityService } from './site-connectivity.service';

const connectivityProperties = {
  type: { type: 'string', enum: ['with_signal', 'without_signal'] },
  minutesToSignal: { type: 'integer', minimum: 0, maximum: 720 },
  marginMinutes: { type: 'integer', minimum: 0, maximum: 180, default: 30 },
};

@ApiTags('Conectividad de predios')
@ApiBearerAuth()
@Controller('predios/:id/conectividad')
export class SiteConnectivityController {
  constructor(private readonly connectivity: SiteConnectivityService) {}

  @Get()
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Consulta la conectividad del predio asignado' })
  @ApiResponse({ status: 200, schema: { type: 'object', properties: connectivityProperties } })
  get(@Param('id') id: string) {
    return this.connectivity.get(id);
  }

  @Put()
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Configura la conectividad para turnos no iniciados' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['type', 'minutesToSignal'],
      properties: connectivityProperties,
    },
  })
  @ApiResponse({ status: 200, schema: { type: 'object', properties: connectivityProperties } })
  @ApiResponse({
    status: 400,
    description: 'Tiempo o margen inválido; sin señal exige tiempo mayor que cero',
  })
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = siteConnectivitySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.connectivity.update(id, parsed.data, user.userId);
  }

  @Get('simular')
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Simula la ventana de inicio y el plazo con la configuración vigente' })
  @ApiQuery({ name: 'inicio', type: String, example: '2030-01-01T13:00:00-03:00' })
  @ApiQuery({ name: 'fin', type: String, example: '2030-01-01T15:00:00-03:00' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        startFrom: { type: 'string', format: 'date-time' },
        syncDeadline: { type: 'string', format: 'date-time' },
      },
    },
  })
  simulate(@Param('id') id: string, @Query() query: unknown) {
    const parsed = connectivitySimulationQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.connectivity.simulate(id, new Date(parsed.data.inicio), new Date(parsed.data.fin));
  }
}
