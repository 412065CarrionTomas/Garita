import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { ALLOWED_ROLES, ALLOW_PENDING_INVITATION, PUBLIC_ROUTE } from './auth.decorators';
import { FIREBASE_IDENTITY_PROVIDER } from './auth.types';
import type { AuthenticatedRequest, FirebaseIdentityProvider } from './auth.types';
import { TenantContext } from './tenant-context';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(FIREBASE_IDENTITY_PROVIDER) private readonly identity: FirebaseIdentityProvider,
    private readonly tenantContext: TenantContext,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const handler = context.getHandler();
    const controller = context.getClass();
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [handler, controller])) return true;
    const auth = request.headers.authorization;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
    let identity: { uid: string };
    try {
      identity = await this.identity.verifyIdToken(auth.slice(7));
    } catch {
      throw new UnauthorizedException();
    }
    const user = await this.prisma.systemPrisma.user.findUnique({
      where: { firebaseUid: identity.uid },
      select: { id: true, companyId: true, role: true, status: true },
    });
    if (!user) throw new UnauthorizedException();
    request.user = {
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      status: user.status,
    };
    this.tenantContext.setUser(request.user);
    const roles: readonly string[] | undefined = this.reflector.getAllAndOverride(ALLOWED_ROLES, [
      handler,
      controller,
    ]);
    if (roles === undefined || roles.length === 0) {
      this.deny(request, 'endpoint sin roles declarados');
      throw new ForbiddenException();
    }
    const allowPendingInvitation = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PENDING_INVITATION,
      [handler, controller],
    );
    if (
      user.status !== 'active' &&
      !(user.status === 'invitation_pending' && allowPendingInvitation)
    ) {
      this.deny(request, `estado ${user.status}`);
      throw new ForbiddenException();
    }
    if (!roles.includes(user.role)) {
      this.deny(request, `rol ${user.role} no permitido`);
      throw new ForbiddenException();
    }
    return true;
  }

  private deny(request: AuthenticatedRequest, reason: string): void {
    this.logger.error({
      userId: request.user?.userId ?? null,
      companyId: request.user?.companyId ?? null,
      endpoint: `${request.method} ${request.originalUrl}`,
      correlationId: request.correlationId,
      reason,
    });
  }
}
