import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RoundReviewService } from './round-review.service';

const idSchema = z.string().min(1).max(100);
const queueSchema = z.object({ predio: idSchema.optional() }).strict();
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
  @ApiOperation({ summary: 'Lista ventanas en revisión y devuelve el contador' })
  @ApiQuery({ name: 'predio', required: false })
  queue(@Query() raw: unknown) {
    return this.reviews.queue(parse(queueSchema, raw).predio);
  }

  @Get('ventanas-ronda/:id')
  @ApiOperation({ summary: 'Consulta registros, marcas e historial de una ventana' })
  detail(@Param('id') id: string) {
    return this.reviews.detail(parse(idSchema, id));
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
