import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ReportExportsService } from './report-exports.service';

@ApiTags('Exportación PDF')
@ApiBearerAuth()
@ApiQuery({
  name: 'desde',
  required: false,
  description: 'Inicio local YYYY-MM-DD; junto con hasta, máximo tres meses calendario',
})
@ApiQuery({
  name: 'hasta',
  required: false,
  description: 'Fin local excluido YYYY-MM-DD; por defecto último mes',
})
@ApiQuery({ name: 'predio', required: false })
@ApiOkResponse({
  description: 'Descarga directa; mismos datos y permisos de la pantalla',
  content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
})
@Controller()
export class ReportExportsController {
  constructor(private readonly exports: ReportExportsService) {}

  @Get('reportes/rondas/pdf')
  @Roles('admin', 'supervisor')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Exporta cumplimiento, comparaciones y listados a PDF' })
  @ApiQuery({ name: 'cliente', required: false })
  @ApiQuery({ name: 'vigilador', required: false })
  rounds(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.download('rounds', raw, user);
  }
  @Get('reportes/incidentes/pdf')
  @Roles('admin', 'supervisor')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Exporta incidentes, tiempos de respuesta y pánico a PDF' })
  @ApiQuery({ name: 'cliente', required: false })
  incidents(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.download('incidents', raw, user);
  }
  @Get('portal/reporte/pdf')
  @Roles('client')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Exporta solo el portal permitido, sin fotos ni datos internos' })
  portal(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.download('portal', raw, user);
  }
  private async download(
    kind: 'rounds' | 'incidents' | 'portal',
    raw: unknown,
    user: AuthenticatedUser,
  ) {
    const { pdf, filename } = await this.exports.export(kind, raw, user);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
      length: pdf.length,
    });
  }
}
