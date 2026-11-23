import { Body, Controller, Get, HttpCode, Ip, Post } from '@nestjs/common';
import { legalAcceptanceRequestSchema, USER_ROLES } from '@garita/shared';
import { parseOrBadRequest } from '../../common/parse-or-bad-request';
import { AllowPendingInvitation, CurrentUser, Roles } from './auth.decorators';
import type { AuthenticatedUser } from './auth.types';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  @Roles(...USER_ROLES)
  @AllowPendingInvitation()
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.userId);
  }

  @Post('terminos')
  @HttpCode(200)
  @Roles(...USER_ROLES)
  acceptLegal(@Body() raw: unknown, @CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    parseOrBadRequest(legalAcceptanceRequestSchema, raw);
    return this.auth.acceptLegal(user.userId, ip);
  }
}
