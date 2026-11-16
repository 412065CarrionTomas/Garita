import { ConflictException } from '@nestjs/common';
import { TenantContext } from '../auth/tenant-context';
import type { UsersService } from '../users/users.service';
import type { PrismaService } from '../prisma/prisma.service';
import { GuardSelectionService } from './guard-selection';

describe('GuardSelectionService', () => {
  const guards = Array.from({ length: 14 }, (_, i) => ({
    id: `g${i}`,
    firstName: `Guard ${i}`,
    lastName: '',
    status: i === 13 ? 'invitation_pending' : 'active',
  }));
  function setup() {
    const users = {
      list: jest.fn().mockResolvedValue({ items: guards, paginas: 1 }),
      countFutureShifts: jest.fn().mockResolvedValue(2),
      detail: jest.fn().mockResolvedValue({ status: 'active' }),
      deactivate: jest.fn().mockResolvedValue({ ok: true }),
    };
    let saved: unknown;
    const db = {
      $executeRaw: jest.fn(),
      subscription: {
        findUniqueOrThrow: jest
          .fn()
          .mockImplementation(() =>
            Promise.resolve({ guardSelection: saved, status: 'authorized' }),
          ),
        update: jest.fn().mockImplementation(({ data }: { data: { guardSelection: unknown } }) => {
          saved = data.guardSelection;
          return Promise.resolve({});
        }),
      },
    };
    const systemPrisma = {
      ...db,
      $transaction: (run: (tx: typeof db) => Promise<unknown>) => run(db),
    };
    const context = new TenantContext();
    const service = new GuardSelectionService(
      users as unknown as UsersService,
      { systemPrisma } as unknown as PrismaService,
      context,
    );
    return {
      service,
      users,
      db,
      save: (value: unknown) => {
        saved = value;
      },
    };
  }
  const selection = {
    guardsToKeep: guards.slice(0, 10).map((g) => g.id),
    shiftDecisions: guards
      .slice(10)
      .map((g) => ({ guardId: g.id, shiftAction: 'unassign' as const, confirmUnassignedCount: 2 })),
  };
  it('requires a decision for all 14 counted guards with a plan of 10', async () => {
    const { service } = setup();
    await expect(service.validate(10, undefined, 'admin')).rejects.toMatchObject({
      response: {
        code: 'guard_selection_required',
        guards: guards.map((guard) => ({
          id: guard.id,
          name: `${guard.firstName} ${guard.lastName}`,
          futureShiftCount: 2,
        })),
      },
    });
  });
  it('rejects foreign IDs, duplicates, missing decisions and derivation to a removed guard', async () => {
    const { service } = setup();
    for (const input of [
      { ...selection, guardsToKeep: ['foreign'] },
      { ...selection, guardsToKeep: ['g0', 'g0'] },
      { ...selection, shiftDecisions: [] },
      {
        guardsToKeep: [],
        shiftDecisions: guards.map((g) => ({
          guardId: g.id,
          shiftAction: 'unassign' as const,
          confirmUnassignedCount: 2,
        })),
      },
      {
        ...selection,
        shiftDecisions: [
          { guardId: 'g10', shiftAction: 'derive' as const, deriveToUserId: 'g11' },
          ...selection.shiftDecisions.slice(1),
        ],
      },
    ])
      await expect(service.validate(10, input, 'admin')).rejects.toBeInstanceOf(ConflictException);
  });
  it('keeps an ongoing guard active, then deactivates it in the next idempotent sweep', async () => {
    const { service, users, db, save } = setup();
    const stored = await service.validate(10, selection, 'admin');
    save(stored);
    users.deactivate.mockRejectedValueOnce(
      new ConflictException({ code: 'GUARD_HAS_SHIFT_IN_PROGRESS' }),
    );
    const remaining = await service.apply('sub', 'company', stored);
    expect(remaining?.pendingGuardIds).toEqual(['g10']);
    expect(users.deactivate).toHaveBeenCalledTimes(4);
    const done = await service.apply('sub', 'company', remaining);
    expect(done?.pendingGuardIds).toEqual([]);
    await service.apply('sub', 'company', done);
    expect(users.deactivate).toHaveBeenCalledTimes(5);
    expect(db.subscription.update).toHaveBeenCalled();
  });
  it('keeps deactivating the other guards when one fails, and leaves that one pending', async () => {
    const { service, users, save } = setup();
    const stored = await service.validate(10, selection, 'admin');
    save(stored);
    users.deactivate.mockRejectedValueOnce(new Error('Vigilador destino no encontrado'));
    const remaining = await service.apply('sub', 'company', stored);
    expect(remaining?.pendingGuardIds).toEqual(['g10']);
    expect(users.deactivate).toHaveBeenCalledTimes(4);
  });
});
