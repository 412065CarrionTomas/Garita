import type { LiveHealthResponse } from '@garita/shared';
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';

import { PrismaService } from '../prisma/prisma.service';
import { RedisHealthIndicator } from './redis.health';
import { Public } from '../auth/auth.decorators';

const CHECK_TIMEOUT_MS = 2_000;

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  /** Indica que el proceso está vivo. No consulta dependencias externas. */
  @Get('live')
  @Public()
  live(): LiveHealthResponse {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Indica si la API puede atender pedidos: PostgreSQL y Redis deben responder. */
  @Get('ready')
  @Public()
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma, { timeout: CHECK_TIMEOUT_MS }),
      () => this.redisHealth.pingCheck('redis').withTimeout(CHECK_TIMEOUT_MS),
    ]);
  }
}
