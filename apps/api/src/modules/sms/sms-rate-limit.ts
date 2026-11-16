import {
  Inject,
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import type { Env } from '../../config/env';
import { CLOCK, type Clock } from '../../common/clock';

@Injectable()
export class SmsRateLimit implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(SmsRateLimit.name);
  constructor(
    config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.client.on('error', () => {
      this.logger.error({ event: 'sms.rate_limit_redis_failed' });
    });
  }
  async check(ip: string): Promise<void> {
    const hash = createHash('sha256').update(ip).digest('hex');
    const key = `sms-inbound:rate:${Math.floor(this.clock.now().getTime() / 60000)}:${hash}`;
    let count: unknown;
    try {
      // Atomic INCR + EXPIRE: a process crash cannot leave an immortal counter.
      count = await this.client.eval(
        "local n = redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], 120); return n",
        1,
        key,
      );
    } catch {
      this.logger.error({ event: 'sms.rate_limit_unavailable' });
      throw new ServiceUnavailableException();
    }
    if (typeof count !== 'number') throw new ServiceUnavailableException();
    if (count > 60) throw new HttpException('Demasiados pedidos', HttpStatus.TOO_MANY_REQUESTS);
  }
  onModuleDestroy() {
    this.client.disconnect();
  }
}
