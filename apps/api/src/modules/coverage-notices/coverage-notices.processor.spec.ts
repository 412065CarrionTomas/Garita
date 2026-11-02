import { CoverageNoticesProcessor } from './coverage-notices.processor';
import type { CoverageNoticesService } from './coverage-notices.service';
import type { Queue } from 'bullmq';
it('programa cada minuto y delega al barrido idempotente', async () => {
  const sweep = jest.fn().mockResolvedValue(undefined),
    upsertJobScheduler = jest.fn().mockResolvedValue(undefined);
  const processor = new CoverageNoticesProcessor(
    { sweep } as unknown as CoverageNoticesService,
    { upsertJobScheduler } as unknown as Queue,
  );
  await processor.onModuleInit();
  await processor.process();
  expect(upsertJobScheduler).toHaveBeenCalledWith(
    'coverage-notices-sweep',
    { every: 60_000 },
    { name: 'sweep', data: {} },
  );
  expect(sweep).toHaveBeenCalledTimes(1);
});
