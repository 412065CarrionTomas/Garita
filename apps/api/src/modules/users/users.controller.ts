import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Ip,
  NotFoundException,
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
  createClientUserRequestSchema,
  invitationRedeemRequestSchema,
  listUsersQuerySchema,
  updateUserRequestSchema,
} from '@garita/shared';
import { CurrentUser, Public, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { parseOrBadRequest } from '../../common/parse-or-bad-request';
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
  z
    .object({ forceDeactivate: z.literal(true), reason: z.string().trim().min(3).max(500) })
    .strict(),
  z
    .object({
      forceDeactivate: z.literal(true),
      reason: z.string().trim().min(3).max(500),
      leaveUnassigned: z.literal(true),
      confirmUnassignedCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      forceDeactivate: z.literal(true),
      reason: z.string().trim().min(3).max(500),
      deriveToUserId: z.string().min(1),
    })
    .strict(),
]);

@ApiTags('Usuarios')
@ApiBearerAuth()
@Controller('usuarios')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles('admin', 'supervisor')
  list(@Query() raw: unknown) {
    return this.users.list(parseOrBadRequest(listUsersQuerySchema, raw));
  }

  @Get(':id')
  @Roles('admin', 'supervisor')
  async detail(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    const user = await this.users.detail(id);
    if (user.role === 'client' && actor.role !== 'admin')
      throw new NotFoundException('Recurso no encontrado');
    return user;
  }

  @Post()
  @Roles('admin')
  create(@Body() raw: unknown, @CurrentUser() admin: AuthenticatedUser) {
    return this.users.create(
      parseOrBadRequest(createUserRequestSchema, raw),
      admin.userId,
      admin.companyId,
    );
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() raw: unknown, @CurrentUser() admin: AuthenticatedUser) {
    return this.users.update(id, parseOrBadRequest(updateUserRequestSchema, raw), admin.userId);
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
        {
          type: 'object',
          required: ['forceDeactivate', 'reason'],
          properties: {
            forceDeactivate: { type: 'boolean', enum: [true] },
            reason: { type: 'string', minLength: 3, maxLength: 500 },
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
    return this.users.redeem(parseOrBadRequest(invitationRedeemRequestSchema, raw).token, ip);
  }
}

@ApiTags('Usuarios de cliente')
@ApiBearerAuth()
@Controller('clientes/:id/usuarios')
export class ClientUsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'Lista accesos al portal, cargo, invitación y Último ingreso' })
  list(@Param('id') id: string) {
    return this.users.listClientUsers(id);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Invita un usuario al portal de un cliente activo por 72 horas' })
  @ApiConflictResponse({ description: 'Correo en uso o cliente dado de baja' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['firstName', 'lastName', 'email'],
      properties: {
        firstName: { type: 'string', minLength: 2, maxLength: 60 },
        lastName: { type: 'string', minLength: 2, maxLength: 60 },
        email: { type: 'string', format: 'email' },
        position: { type: 'string', maxLength: 80 },
      },
    },
  })
  create(@Param('id') id: string, @Body() raw: unknown, @CurrentUser() admin: AuthenticatedUser) {
    const parsed = createClientUserRequestSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Los datos enviados no son válidos');
    return this.users.createClientUser(id, parsed.data, admin.userId, admin.companyId);
  }
}
