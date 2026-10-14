import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { SYNC_ERROR_CODES } from '@garita/shared';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { TenantContext } from '../auth/tenant-context';
import { ShiftCredentialService, type ShiftCredentialPayload } from './shift-credential.service';

export interface SyncRequest extends AuthenticatedRequest {
  shiftCredential: ShiftCredentialPayload;
}

@Injectable()
export class ShiftCredentialGuard implements CanActivate {
  private readonly logger = new Logger(ShiftCredentialGuard.name);

  constructor(
    private readonly shiftCredentialService: ShiftCredentialService,
    private readonly tenantContext: TenantContext,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SyncRequest>();
    const auth = request.headers.authorization;

    if (!auth?.startsWith('Bearer ')) {
      this.logger.warn({
        endpoint: `${request.method} ${request.originalUrl}`,
        reason: 'Cabecera Authorization ausente o no es Bearer',
      });
      throw new UnauthorizedException({
        code: SYNC_ERROR_CODES.invalidCredential,
        message: 'Credencial de turno requerida',
      });
    }

    const token = auth.slice(7).trim();
    const result = await this.shiftCredentialService.verifyCredential(token);

    if (!result.valid) {
      this.logger.warn({
        endpoint: `${request.method} ${request.originalUrl}`,
        reason: `Credencial de turno no válida: ${result.reason}`,
      });
      throw new UnauthorizedException({
        code: SYNC_ERROR_CODES.invalidCredential,
        message: 'Credencial de turno no válida o vencida',
      });
    }

    request.shiftCredential = result.payload;
    request.user = {
      userId: result.payload.userId,
      companyId: result.payload.companyId,
      role: 'guard',
      status: 'active',
    };

    this.tenantContext.setUser(request.user);

    return true;
  }
}
