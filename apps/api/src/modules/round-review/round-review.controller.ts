import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RoundReviewService } from './round-review.service';

const idSchema = z.string().min(1).max(100);
const queueSchema = z
  .object({
    predio: idSchema.optional(),
    estado: z.enum(['pendientes', 'resueltas']).default('pendientes'),
    desde: z.iso.date().optional(),
    hasta: z.iso.date().optional(),
  })
  .strict()
  .refine((q) => !q.desde || !q.hasta || q.desde <= q.hasta, {
    message: 'La fecha inicial debe ser anterior a la final',
  });
const decisionSchema = z.object({ comment: z.string().trim().min(5).max(500) }).strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.issues);
  return result.data;
}

@ApiTags('Revisión de rondas')
@ApiBearerAuth()
@Controller()
@Roles('admin', 'supervisor')
export class RoundReviewController {
  constructor(private readonly reviews: RoundReviewService) {}

  @Get('ventanas-ronda/en-revision')
  @ApiOperation({ summary: 'Lista ventanas pendientes o resueltas (30 días) y los contadores' })
  @ApiQuery({ name: 'predio', required: false })
  @ApiQuery({ name: 'estado', required: false, enum: ['pendientes', 'resueltas'] })
  @ApiQuery({ name: 'desde', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'hasta', required: false, type: String, format: 'date' })
  queue(@Query() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.reviews.queue(user, parse(queueSchema, raw));
  }

  @Get('ventanas-ronda/:id')
  @ApiOperation({ summary: 'Consulta registros, marcas e historial de una ventana' })
  detail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reviews.detail(parse(idSchema, id), user);
  }

  @Post('ventanas-ronda/:id/validar')
  @ApiOperation({ summary: 'Valida una ventana en revisión' })
  validate(@Param('id') id: string, @Body() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.reviews.validate(parse(idSchema, id), user, parse(decisionSchema, raw).comment);
  }

  @Post('registros-puntos/:id/invalidar')
  @ApiOperation({ summary: 'Invalida un registro sin borrarlo' })
  invalidate(
    @Param('id') id: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.recordDecision(
      parse(idSchema, id),
      'invalidate',
      user,
      parse(decisionSchema, raw).comment,
    );
  }

  @Post('registros-puntos/:id/restituir')
  @ApiOperation({ summary: 'Restituye un registro invalidado' })
  restore(@Param('id') id: string, @Body() raw: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.reviews.recordDecision(
      parse(idSchema, id),
      'restore',
      user,
      parse(decisionSchema, raw).comment,
    );
  }
}
