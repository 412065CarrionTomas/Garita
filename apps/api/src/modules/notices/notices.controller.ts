import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { noticesQuerySchema } from '@garita/shared';
import { z } from 'zod';
import { Roles } from '../auth/auth.decorators';
import { NoticesService } from './notices.service';

@ApiTags('Avisos')
@ApiBearerAuth()
@Controller('avisos')
@Roles('admin', 'supervisor')
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista avisos y cantidad abierta' })
  @ApiQuery({ name: 'estado', required: false })
  @ApiQuery({ name: 'tipo', required: false })
  @ApiQuery({ name: 'predio', required: false })
  list(@Query() raw: unknown) {
    const parsed = z
      .object({
        estado: z.string().optional(),
        tipo: z.string().optional(),
        predio: z.string().optional(),
      })
      .strict()
      .safeParse(raw);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const query = noticesQuerySchema.safeParse({
      status: parsed.data.estado,
      kind: parsed.data.tipo,
      siteId: parsed.data.predio,
    });
    if (!query.success) throw new BadRequestException(query.error.issues);
    return this.notices.list(query.data);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consulta un aviso' })
  detail(@Param('id') id: string) {
    const parsed = z.string().min(1).max(100).safeParse(id);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.notices.detail(parsed.data);
  }
}
