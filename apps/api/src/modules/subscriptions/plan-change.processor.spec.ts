import type { Job, Queue } from 'bullmq';
import type { PrismaService } from '../prisma/prisma.service';
import type { PlanChangeService } from './plan-change.service';
import { PlanChangeProcessor } from './plan-change.processor';

describe('barrido de cambios de plan', () => {
  function setup() {
    const s = { id: 's', companyId: 'c', status: 'authorized', guardSelection: null };
    const db = {
      planChangePayment: { updateMany: jest.fn() },
      subscription: {
        findMany: jest.fn().mockResolvedValue([s]),
        findUniqueOrThrow: jest.fn().mockResolvedValue(s),
      },
    };
    const changes = { applyDowngrade: jest.fn(), repairAmount: jest.fn() };
    const queue = { upsertJobScheduler: jest.fn() };
    const processor = new PlanChangeProcessor(
      { systemPrisma: db } as unknown as PrismaService,
      changes as unknown as PlanChangeService,
      { now: () => new Date('2030-11-11T12:00:00Z') },
      queue as unknown as Queue,
    );
    return { processor, db, changes, queue };
  }
  it('programa barridos de cinco minutos y comparación diaria con reintentos', async () => {
    const { processor, queue } = setup();
    await processor.onModuleInit();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'subscription-plan-change-sweep',
      { every: 300_000 },
      expect.objectContaining({ name: 'sweep', data: { kind: 'sweep' } }),
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'subscription-plan-change-daily',
      expect.objectContaining({ pattern: '15 3 * * *' }),
      expect.anything(),
    );
  });
  it('vence pagos abandonados y reintenta bajas e importes pendientes', async () => {
    const { processor, db, changes } = setup();
    await processor.process({ data: { kind: 'sweep' } } as Job);
    expect(db.planChangePayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'pending', expiresAt: { lte: new Date('2030-11-11T12:00:00Z') } },
      }),
    );
    expect(changes.applyDowngrade).toHaveBeenCalledWith('s');
    expect(changes.repairAmount).toHaveBeenCalledWith('s', false);
    await processor.process({ data: { kind: 'daily' } } as Job);
    expect(changes.repairAmount).toHaveBeenLastCalledWith('s', true);
  });
  it('valida jobs y conserva el fallo para el reintento', async () => {
    const { processor, changes } = setup();
    await expect(processor.process({ data: { kind: 'otro' } } as Job)).rejects.toThrow();
    changes.applyDowngrade.mockRejectedValueOnce(new Error('sin conexión'));
    await expect(processor.process({ data: { kind: 'daily' } } as Job)).rejects.toThrow(
      'reintento',
    );
  });
});
