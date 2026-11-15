import { AccountTrialProcessor } from './account-trial.processor';

it('registra el barrido cada minuto con reintentos y procesa la prueba', async () => {
  const trial = { sweep: jest.fn().mockResolvedValue(undefined) };
  const queue = { upsertJobScheduler: jest.fn().mockResolvedValue(undefined) };
  const processor = new AccountTrialProcessor(trial as never, queue as never);
  await processor.onModuleInit();
  await processor.process();
  expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
    'account-trial-sweep',
    { every: 60_000 },
    expect.objectContaining({ opts: expect.objectContaining({ attempts: 3 }) as unknown }),
  );
  expect(trial.sweep).toHaveBeenCalledTimes(1);
});
