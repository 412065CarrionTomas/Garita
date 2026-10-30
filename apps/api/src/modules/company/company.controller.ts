import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CompanyService } from './company.service';

const guardPhoneSchema = z
  .object({
    guardPhone: z
      .string()
      .regex(/^\+[1-9]\d{1,14}$/)
      .nullable(),
  })
  .strict();
const responseSchema = {
  type: 'object' as const,
  required: ['guardPhone'],
  properties: {
    guardPhone: { type: 'string' as const, nullable: true, pattern: '^\\+[1-9]\\d{1,14}$' },
  },
};

@ApiTags('Empresa')
@ApiBearerAuth()
@Controller('empresa/telefono-guardia')
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'Consulta el teléfono de guardia de la empresa autenticada' })
  @ApiResponse({ status: 200, schema: responseSchema })
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.company.get(user.companyId);
  }

  @Put()
  @Roles('admin')
  @ApiOperation({ summary: 'Configura un único teléfono E.164; null lo elimina' })
  @ApiBody({ schema: responseSchema })
  @ApiResponse({ status: 200, schema: responseSchema })
  @ApiResponse({ status: 400, description: 'Teléfono inválido' })
  @ApiResponse({ status: 403, description: 'Solo administradores' })
  update(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = guardPhoneSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.company.update(user.companyId, parsed.data.guardPhone);
  }
}
