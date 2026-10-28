import { liveHealthResponseSchema } from '@garita/shared';
import { HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: {} },
        { provide: PrismaHealthIndicator, useValue: {} },
        { provide: RedisHealthIndicator, useValue: {} },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('responde con el contrato compartido de disponibilidad', () => {
    const response = controller.live();

    expect(liveHealthResponseSchema.safeParse(response).success).toBe(true);
  });
});
