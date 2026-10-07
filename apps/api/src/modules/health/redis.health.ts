import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Redis } from 'ioredis';

import type { Env } from '../../config/env';

/** Verifica que Redis responda a PING. Usa una conexión propia, separada de las colas. */
@Injectable()
export class RedisHealthIndicator implements OnModuleDestroy {
  private readonly logger = new Logger(RedisHealthIndicator.name);
  private readonly client: Redis;

  constructor(
    config: ConfigService<Env, true>,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    // Sin este listener, ioredis reporta los errores de conexión como eventos no manejados.
    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis no disponible: ${error.message}`);
    });
  }

  pingCheck<const Key extends string>(key: Key) {
    return this.healthIndicatorService.check(key).attempt(async () => {
      if (this.client.status === 'wait') {
        await this.client.connect();
      }
      await this.client.ping();
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'wait' && this.client.status !== 'end') {
      await this.client.quit();
    }
  }
}
