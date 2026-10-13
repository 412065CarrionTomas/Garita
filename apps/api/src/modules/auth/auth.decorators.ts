import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@garita/shared';
import type { AuthenticatedRequest } from './auth.types';

export const PUBLIC_ROUTE = 'auth:public';
export const ALLOWED_ROLES = 'auth:roles';
export const ALLOW_PENDING_INVITATION = 'auth:allow-pending-invitation';
export const ALLOW_DEACTIVATED_FIELD_EVENT = 'auth:allow-deactivated-field-event';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const Roles = (...roles: UserRole[]) => SetMetadata(ALLOWED_ROLES, roles);
export const AllowPendingInvitation = () => SetMetadata(ALLOW_PENDING_INVITATION, true);
/** Allows a disabled guard to upload final audit events for an already closed assignment. */
export const AllowDeactivatedFieldEvent = () => SetMetadata(ALLOW_DEACTIVATED_FIELD_EVENT, true);
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
