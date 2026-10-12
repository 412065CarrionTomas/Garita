import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  NotFoundException,
} from '@nestjs/common';
import {
  clientInputSchema,
  clientListQuerySchema,
  siteInputSchema,
  siteListQuerySchema,
  supervisorAssignmentSchema,
} from '@garita/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SitesService } from './sites.service';

function parse<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('Los datos enviados no son válidos');
  return result.data;
}

@Controller()
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get('clientes')
  @Roles('admin', 'supervisor')
  clients(@Query() query: unknown) {
    const parsed = parse(clientListQuerySchema, query);
    return this.sites.listClients(parsed.estado, parsed.pagina);
  }
  @Post('clientes')
  @Roles('admin')
  createClient(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.sites.createClient({
      ...parse(clientInputSchema, body),
      companyId: user.companyId,
    });
  }
  @Patch('clientes/:id')
  @Roles('admin')
  updateClient(@Param('id') id: string, @Body() body: unknown) {
    return this.sites.updateClient(id, parse(clientInputSchema, body));
  }
  @Post('clientes/:id/baja')
  @Roles('admin')
  deactivateClient(@Param('id') id: string) {
    return this.sites.deactivateClient(id);
  }
  @Get('clientes/:id')
  @Roles('admin', 'supervisor')
  getClient(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.sites.getClient(id, user);
  }

  @Get('predios')
  @Roles('admin', 'supervisor')
  listSites(@Query() query: unknown) {
    const parsed = parse(siteListQuerySchema, query);
    return this.sites.listSites(parsed.cliente, parsed.estado);
  }
  @Get('predios/supervisores-disponibles')
  @Roles('admin')
  availableSupervisors() {
    return this.sites.availableSupervisors();
  }
  @Get('predios/:id')
  @Roles('admin', 'supervisor')
  getSite(@Param('id') id: string) {
    return this.sites.getSite(id);
  }
  @Post('predios')
  @Roles('admin')
  createSite(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const data = parse(siteInputSchema, body);
    return this.sites.createSite({ ...data, companyId: user.companyId });
  }
  @Patch('predios/:id')
  @Roles('admin')
  updateSite(@Param('id') id: string, @Body() body: unknown) {
    return this.sites.updateSite(id, parse(siteInputSchema, body));
  }
  @Post('predios/:id/baja')
  @Roles('admin')
  deactivateSite(@Param('id') id: string) {
    return this.sites.deactivateSite(id);
  }
  @Get('predios/:id/supervisores')
  @Roles('admin')
  supervisors(@Param('id') id: string) {
    return this.sites.getSupervisors(id);
  }
  @Put('predios/:id/supervisores')
  @Roles('admin')
  replaceSupervisors(@Param('id') id: string, @Body() body: unknown) {
    return this.sites.replaceSupervisors(id, parse(supervisorAssignmentSchema, body).supervisorIds);
  }
  @Get('usuarios/:id/predios')
  @Roles('admin', 'supervisor')
  async userSites(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    if (user.role === 'supervisor' && user.userId !== id)
      throw new NotFoundException('Recurso no encontrado');
    return this.sites.sitesForSupervisor(id);
  }
}
