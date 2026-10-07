import { buildQueueOptions } from './queue.config';

describe('buildQueueOptions', () => {
  it('usa la URL de Redis y configura reintentos con backoff exponencial', () => {
    const options = buildQueueOptions('redis://localhost:6379');

    expect(options.connection).toEqual({ url: 'redis://localhost:6379' });
    expect(options.defaultJobOptions?.attempts).toBeGreaterThan(1);
    expect(options.defaultJobOptions?.backoff).toEqual({ type: 'exponential', delay: 2_000 });
  });
});
