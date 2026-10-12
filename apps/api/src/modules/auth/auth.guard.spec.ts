import { ForbiddenException, Logger } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ALLOWED_ROLES, ALLOW_PENDING_INVITATION, PUBLIC_ROUTE } from './auth.decorators';
import { AuthGuard } from './auth.guard';
import type { AuthenticatedRequest, FirebaseIdentityProvider } from './auth.types';
import type { TenantContext } from './tenant-context';
import type { PrismaService } from '../prisma/prisma.service';

describe('AuthGuard', () => {
  const handler = (): void => undefined;
  class TestController {
    testMethod(): boolean {
      return true;
    }
  }

  function buildGuard(
    options: {
      roles?: readonly string[];
      user?: {
        id: string;
        companyId: string;
        role: 'admin' | 'guard';
        status: 'active' | 'invitation_pending';
      };
    } = {},
  ) {
    const request: AuthenticatedRequest = {
      headers: { authorization: 'Bearer test-token' },
      method: 'GET',
      originalUrl: '/api/v1/test',
      path: '/api/v1/test',
    } as AuthenticatedRequest;
    const executionContext = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => TestController,
    } as unknown as ExecutionContext;
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === PUBLIC_ROUTE) return false;
        if (key === ALLOWED_ROLES) return options.roles;
        if (key === ALLOW_PENDING_INVITATION) return false;
        return undefined;
      }),
    } as unknown as Reflector;
    const systemPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(
          options.user ?? {
            id: 'user-1',
            companyId: 'company-1',
            role: 'guard',
            status: 'active',
          },
        ),
      },
    };
    const prisma = { systemPrisma } as unknown as PrismaService;
    const identity: FirebaseIdentityProvider = {
      verifyIdToken: () => Promise.resolve({ uid: 'firebase-user' }),
    };
    const setUser = jest.fn();
    const tenantContext = { setUser } as unknown as TenantContext;
    const guard = new AuthGuard(reflector, prisma, identity, tenantContext);
    return { guard, executionContext, request, systemPrisma, setUser };
  }

  it('deniega el rol no permitido después de cargar el usuario y fijar el contexto tenant', async () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { guard, executionContext, request, setUser } = buildGuard({ roles: ['admin'] });

    await expect(guard.canActivate(executionContext)).rejects.toBeInstanceOf(ForbiddenException);
    expect(setUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', companyId: 'company-1' }),
    );
    expect(request.user?.role).toBe('guard');
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        companyId: 'company-1',
        reason: 'rol guard no permitido',
      }),
    );
    logger.mockRestore();
  });

  it('carga la identidad antes de denegar una ruta sin roles', async () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { guard, executionContext, systemPrisma } = buildGuard();

    await expect(guard.canActivate(executionContext)).rejects.toBeInstanceOf(ForbiddenException);
    expect(systemPrisma.user.findUnique).toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        companyId: 'company-1',
        reason: 'endpoint sin roles declarados',
      }),
    );
    logger.mockRestore();
  });
});
