import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Ip,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  createUserRequestSchema,
  invitationRedeemRequestSchema,
  listUsersQuerySchema,
  updateUserRequestSchema,
} from '@garita/shared';
import { CurrentUser, Public, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { UsersService } from './users.service';

const deactivateSchema = z.union([
  z.object({ deriveToUserId: z.string().min(1) }).strict(),
  z
    .object({
      leaveUnassigned: z.literal(true),
      confirmUnassignedCount: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({}).strict(),
]);

@ApiTags('Usuarios')
@ApiBearerAuth()
@Controller('usuarios')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles('admin', 'supervisor')
  list(@Query() raw: unknown) {
    return this.users.list(listUsersQuerySchema.parse(raw));
  }

  @Get(':id')
  @Roles('admin', 'supervisor')
  detail(@Param('id') id: string) {
    return this.users.detail(id);
  }

  @Post()
  @Roles('admin')
  create(@Body() raw: unknown, @CurrentUser() admin: AuthenticatedUser) {
    return this.users.create(createUserRequestSchema.parse(raw), admin.userId, admin.companyId);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() raw: unknown, @CurrentUser() admin: AuthenticatedUser) {
    return this.users.update(id, updateUserRequestSchema.parse(raw), admin.userId);
  }

  @Post(':id/desactivar')
  @Roles('admin')
  @ApiOperation({ summary: 'Desactiva un usuario y deriva o libera sus turnos futuros' })
  @ApiBody({
    schema: {
      oneOf: [
        {
          type: 'object',
          required: ['deriveToUserId'],
          properties: { deriveToUserId: { type: 'string' } },
        },
        {
          type: 'object',
          required: ['leaveUnassigned', 'confirmUnassignedCount'],
          properties: {
            leaveUnassigned: { type: 'boolean', enum: [true] },
            confirmUnassignedCount: { type: 'integer', minimum: 0 },
          },
        },
      ],
    },
  })
  @ApiConflictResponse({
    description: 'Falta decisión sobre turnos o el conteo confirmado no coincide',
  })
  deactivate(
    @Param('id') id: string,
    @Body() raw: unknown,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    const parsed = deactivateSchema.safeParse(raw ?? {});
    if (!parsed.success) throw new BadRequestException('Los datos enviados no son válidos');
    return this.users.deactivate(id, admin.userId, parsed.data);
  }

  @Post(':id/reactivar')
  @Roles('admin')
  reactivate(@Param('id') id: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.users.reactivate(id, admin.userId);
  }

  @Post(':id/reenviar-invitacion')
  @Roles('admin')
  resend(@Param('id') id: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.users.resend(id, admin.userId);
  }
}

@Controller('invitaciones')
export class InvitationsController {
  constructor(private readonly users: UsersService) {}
  @Post('canjear')
  @Public()
  redeem(@Body() raw: unknown, @Ip() ip: string) {
    return this.users.redeem(invitationRedeemRequestSchema.parse(raw).token, ip);
  }
}
