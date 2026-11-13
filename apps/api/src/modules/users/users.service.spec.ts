import { ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantResourceService } from '../auth/tenant-resource.service';
import type { FirebaseIdentityProvider } from '../auth/auth.types';
import type { ResendInvitationMailer } from './email.service';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import type { WeeklyScheduleDerivationPort } from './weekly-schedule-derivation.port';
import type { ShiftExecutionService } from '../shift-execution/shift-execution.service';

describe('UsersService invitation lifecycle', () => {
  const user = {
    id: 'user',
    firebaseUid: 'uid',
    role: 'guard',
    status: 'deactivated',
    clientId: null,
  };
  const db = {
    user: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    invitation: { findFirst: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
    client: { updateMany: jest.fn() },
  };
  const transaction = jest.fn((run: (tx: typeof db) => Promise<unknown>) => run(db));
  const firebase = { setDisabled: jest.fn(() => Promise.resolve()) };
  const service = new UsersService(
    { tenantPrisma: { ...db, $transaction: transaction } } as unknown as PrismaService,
    { findOwnedOrThrow: jest.fn() } as unknown as TenantResourceService,
    firebase as unknown as FirebaseIdentityProvider,
    {} as ResendInvitationMailer,
    {} as ConfigService<Env, true>,
    { now: () => new Date('2026-11-13T12:00:00Z') },
    {} as WeeklyScheduleDerivationPort,
    {} as ShiftExecutionService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    db.user.findUniqueOrThrow.mockResolvedValue(user);
    db.invitation.findFirst.mockResolvedValue(null);
    transaction.mockImplementation((run) => run(db));
    db.user.update.mockResolvedValue(user);
  });

  it('reactivates an account with no used invitation as pending and keeps Firebase disabled', async () => {
    await service.reactivate('user', 'admin');
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'user' },
      data: { status: 'invitation_pending' },
    });
    expect(firebase.setDisabled).toHaveBeenCalledWith('uid', true);
    expect(db.invitation.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user', usedAt: { not: null } },
    });
  });

  it('restores active access only after a prior first login', async () => {
    db.invitation.findFirst.mockResolvedValue({ id: 'used-invitation', usedAt: new Date() });
    await service.reactivate('user', 'admin');
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'user' },
      data: { status: 'active' },
    });
    expect(firebase.setDisabled).toHaveBeenCalledWith('uid', false);
  });

  it('disables Firebase again if reactivation fails in PostgreSQL', async () => {
    db.invitation.findFirst.mockResolvedValue({ id: 'used-invitation', usedAt: new Date() });
    const error = new Error('transaction failed');
    transaction.mockRejectedValueOnce(error);
    await expect(service.reactivate('user', 'admin')).rejects.toBe(error);
    expect(firebase.setDisabled.mock.calls).toEqual([
      ['uid', false],
      ['uid', true],
    ]);
  });

  it.each(['active', 'deactivated'])(
    'rejects resend for %s without creating or replacing invitations',
    async (status) => {
      db.user.findUniqueOrThrow.mockResolvedValue({ ...user, status });
      await expect(service.resend('user', 'admin')).rejects.toBeInstanceOf(ConflictException);
      expect(db.invitation.updateMany).not.toHaveBeenCalled();
      expect(db.invitation.create).not.toHaveBeenCalled();
    },
  );
});
