import type { UserRole, UserStatus } from '@garita/shared';
import type { Request } from 'express';

export interface AuthenticatedUser {
  userId: string;
  companyId: string;
  role: UserRole;
  status: UserStatus;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  correlationId?: string;
}

export interface FirebaseIdentityProvider {
  verifyIdToken(token: string): Promise<{ uid: string }>;
  createDisabledUser(email: string): Promise<{ uid: string }>;
  setDisabled(uid: string, disabled: boolean): Promise<void>;
  revokeRefreshTokens(uid: string): Promise<void>;
  generatePasswordResetLink(email: string): Promise<string>;
}

export const FIREBASE_IDENTITY_PROVIDER = Symbol('FIREBASE_IDENTITY_PROVIDER');
