import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@garita/shared';
import type { AuthenticatedRequest } from './auth.types';

export const PUBLIC_ROUTE = 'auth:public';
export const ALLOWED_ROLES = 'auth:roles';
export const ALLOW_PENDING_INVITATION = 'auth:allow-pending-invitation';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const Roles = (...roles: UserRole[]) => SetMetadata(ALLOWED_ROLES, roles);
export const AllowPendingInvitation = () => SetMetadata(ALLOW_PENDING_INVITATION, true);
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
