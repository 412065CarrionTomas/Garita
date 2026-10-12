import { Controller, Get } from '@nestjs/common';
import { USER_ROLES } from '@garita/shared';
import { CurrentUser, Roles } from './auth.decorators';
import type { AuthenticatedUser } from './auth.types';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  @Roles(...USER_ROLES)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.userId);
  }
}
