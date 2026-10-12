import { Body, Controller, Get, Ip, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createUserRequestSchema,
  invitationRedeemRequestSchema,
  listUsersQuerySchema,
  updateUserRequestSchema,
} from '@garita/shared';
import { CurrentUser, Public, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { UsersService } from './users.service';

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
  deactivate(@Param('id') id: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.users.deactivate(id, admin.userId);
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
