import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { accountStateResponseSchema } from '@garita/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AccountService } from './account.service';

@ApiTags('Cuenta')
@ApiBearerAuth()
@Controller('cuenta')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get('estado')
  @Roles('admin')
  @ApiOperation({ summary: 'Consulta el estado, días restantes y cupo de la empresa autenticada' })
  @ApiResponse({ status: 200, standardSchema: accountStateResponseSchema })
  @ApiResponse({ status: 401, description: 'Sin sesión' })
  @ApiResponse({ status: 403, description: 'Solo administradores' })
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.account.response(user.companyId);
  }
}
