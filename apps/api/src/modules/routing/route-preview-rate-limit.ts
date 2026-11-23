import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../../config/env';
import { CLOCK, type Clock } from '../../common/clock';

/** Pedidos de vista previa por usuario y minuto. El editor espera 400 ms entre cambios. */
export const ROUTE_PREVIEW_PER_MINUTE = 30;

/** Cuida la cuota de openrouteservice (40 por minuto para toda la cuenta). */
@Injectable()
export class RoutePreviewRateLimit implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(RoutePreviewRateLimit.name);

  constructor(
    config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.client.on('error', () => {
      this.logger.error({ event: 'routing.preview_rate_limit_redis_failed' });
    });
  }

  async check(userId: string): Promise<void> {
    const key = `routing:preview:${String(Math.floor(this.clock.now().getTime() / 60000))}:${userId}`;
    let count: unknown;
    try {
      // INCR + EXPIRE atómicos: una caída del proceso no deja un contador eterno.
      count = await this.client.eval(
        "local n = redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], 120); return n",
        1,
        key,
      );
    } catch {
      this.logger.error({ event: 'routing.preview_rate_limit_unavailable' });
      throw new ServiceUnavailableException();
    }
    if (typeof count !== 'number') throw new ServiceUnavailableException();
    if (count > ROUTE_PREVIEW_PER_MINUTE)
      throw new HttpException(
        'Demasiados pedidos de vista previa; esperá un momento',
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}
