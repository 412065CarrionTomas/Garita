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
    companyId: 'company',
    role: 'guard',
    status: 'deactivated',
    clientId: null,
  };
  const db = {
    shift: {
      findMany: jest.fn().mockResolvedValue([{ id: 'future' }]),
      count: jest.fn().mockResolvedValue(1),
    },
    user: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    invitation: { count: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
    client: { updateMany: jest.fn() },
  };
  const transaction = jest.fn((run: (tx: typeof db) => Promise<unknown>) => run(db));
  const firebase = { setDisabled: jest.fn(() => Promise.resolve()) };
  const account = { assertGuardSlot: jest.fn().mockResolvedValue(undefined) };
  const service = new UsersService(
    { tenantPrisma: { ...db, $transaction: transaction } } as unknown as PrismaService,
    { findOwnedOrThrow: jest.fn() } as unknown as TenantResourceService,
    firebase as unknown as FirebaseIdentityProvider,
    {} as ResendInvitationMailer,
    {} as ConfigService<Env, true>,
    { now: () => new Date('2026-11-13T12:00:00Z') },
    {} as WeeklyScheduleDerivationPort,
    {} as ShiftExecutionService,
    account as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    db.user.findUniqueOrThrow.mockResolvedValue(user);
    // Por defecto: tiene una invitación y ninguna usada.
    db.invitation.count.mockImplementation(({ where }: { where: { usedAt?: unknown } }) =>
      Promise.resolve(where.usedAt ? 0 : 1),
    );
    transaction.mockImplementation((run) => run(db));
    db.user.update.mockResolvedValue(user);
  });

  it('busca cada palabra en nombre, correo o legajo y filtra envíos fallidos', async () => {
    for (const n of [7, 4, 2, 1, 1]) db.user.count.mockResolvedValueOnce(n);
    db.user.findMany.mockResolvedValue([]);
    const page = await service.list({
      buscar: ' bruno  paz ',
      estado: 'invitation_failed',
      orden: 'nombre',
      pagina: 2,
      porPagina: 5,
    });
    const args = (db.user.findMany.mock.calls as unknown[][])[0]?.[0] as {
      where: { AND: { OR: object[] }[]; status: string; invitations: object };
      skip: number;
      take: number;
      orderBy: object[];
    };
    expect(args.where.AND).toHaveLength(2);
    expect(args.where.AND[0]?.OR).toContainEqual({
      employeeNumber: { contains: 'bruno', mode: 'insensitive' },
    });
    expect(args.where.status).toBe('invitation_pending');
    expect(args.where.invitations).toEqual({
      some: { sendStatus: 'failed', usedAt: null, replacedAt: null },
    });
    expect(args).toMatchObject({ skip: 5, take: 5 });
    expect(args.orderBy[0]).toEqual({ firstName: 'asc' });
    expect(page).toMatchObject({
      total: 7,
      paginas: 2,
      resumen: { active: 4, invitation_pending: 2, invitation_failed: 1, deactivated: 1 },
    });
  });

  it('counts only future scheduled shifts assigned to the owned guard', async () => {
    await expect(service.countFutureShifts('user')).resolves.toBe(1);
    expect(db.shift.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'scheduled',
          startsAt: { gt: new Date('2026-11-13T12:00:00Z') },
          assignments: { some: { guardId: 'user', isCurrent: true, active: true } },
        },
      }),
    );
  });

  it('reactivates an account with no used invitation as pending and keeps Firebase disabled', async () => {
    await service.reactivate('user', 'admin');
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'user' },
      data: { status: 'invitation_pending' },
    });
    expect(firebase.setDisabled).toHaveBeenCalledWith('uid', true);
  });

  it('verifica el cupo para todo vigilador sin depender del estado leído antes de la transacción', async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ ...user, status: 'active' });
    await service.reactivate('user', 'admin');
    expect(account.assertGuardSlot).toHaveBeenCalledWith('company', db);
  });

  it('restores active access only after a prior first login', async () => {
    db.invitation.count.mockResolvedValue(1);
    await service.reactivate('user', 'admin');
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'user' },
      data: { status: 'active' },
    });
    expect(firebase.setDisabled).toHaveBeenCalledWith('uid', false);
  });

  it('keeps an account without invitations (initial seed) active', async () => {
    db.invitation.count.mockResolvedValue(0);
    await service.reactivate('user', 'admin');
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'user' },
      data: { status: 'active' },
    });
    expect(firebase.setDisabled).toHaveBeenCalledWith('uid', false);
  });

  it('disables Firebase again if reactivation fails in PostgreSQL', async () => {
    db.invitation.count.mockResolvedValue(1);
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
