import type { QueueOptions } from 'bullmq';

/**
 * Opciones comunes de las colas de BullMQ. Los jobs se reintentan con backoff exponencial,
 * por lo que cada procesador debe ser idempotente.
 */
export function buildQueueOptions(redisUrl: string): QueueOptions {
  return {
    connection: { url: redisUrl },
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 5_000 },
    },
  };
}
