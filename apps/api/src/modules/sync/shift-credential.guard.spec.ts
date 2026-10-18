import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ShiftCredentialGuard } from './shift-credential.guard';
import type { SyncRequest } from './shift-credential.guard';
import type { ShiftCredentialService } from './shift-credential.service';
import type { TenantContext } from '../auth/tenant-context';

describe('ShiftCredentialGuard', () => {
  let guard: ShiftCredentialGuard;
  let shiftCredentialService: ShiftCredentialService;
  let tenantContext: TenantContext;
  let request: SyncRequest;
  let executionContext: ExecutionContext;
  let verifyCredentialMock: jest.Mock;
  let setUserMock: jest.Mock;

  beforeEach(() => {
    request = {
      headers: {},
      method: 'POST',
      originalUrl: '/api/v1/sincronizacion/eventos',
    } as unknown as SyncRequest;
    executionContext = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    verifyCredentialMock = jest.fn();
    shiftCredentialService = {
      verifyCredential: verifyCredentialMock,
    } as unknown as ShiftCredentialService;

    setUserMock = jest.fn();
    tenantContext = {
      setUser: setUserMock,
    } as unknown as TenantContext;

    guard = new ShiftCredentialGuard(shiftCredentialService, tenantContext);
  });

  it('lanza 401 si falta la cabecera Authorization', async () => {
    await expect(guard.canActivate(executionContext)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(executionContext)).rejects.toMatchObject({
      response: { code: 'INVALID_SHIFT_CREDENTIAL' },
    });
  });

  it('lanza 401 si Authorization no es Bearer', async () => {
    request.headers.authorization = 'Basic abc123';
    await expect(guard.canActivate(executionContext)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(executionContext)).rejects.toMatchObject({
      response: { code: 'INVALID_SHIFT_CREDENTIAL' },
    });
  });

  it('lanza 401 si la credencial es inválida o vencida', async () => {
    request.headers.authorization = 'Bearer bad-token';
    verifyCredentialMock.mockResolvedValue({
      valid: false,
      reason: 'expired',
    });

    await expect(guard.canActivate(executionContext)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(executionContext)).rejects.toMatchObject({
      response: { code: 'INVALID_SHIFT_CREDENTIAL' },
    });
  });

  it('permite el acceso y fija el contexto tenant si la credencial es válida', async () => {
    request.headers.authorization = 'Bearer valid-token';
    const payload = {
      shiftId: 'shift-1',
      assignmentId: 'assign-1',
      userId: 'guard-1',
      companyId: 'company-1',
      exp: 1800000000,
    };
    verifyCredentialMock.mockResolvedValue({
      valid: true,
      payload,
    });

    const allowed = await guard.canActivate(executionContext);
    expect(allowed).toBe(true);
    expect(request.shiftCredential).toEqual(payload);
    expect(request.user).toEqual({
      userId: 'guard-1',
      companyId: 'company-1',
      role: 'guard',
      status: 'active',
    });
    expect(setUserMock).toHaveBeenCalledWith(request.user);
  });
});
