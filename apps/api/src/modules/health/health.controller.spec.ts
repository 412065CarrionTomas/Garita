import { liveHealthResponseSchema } from '@garita/shared';
import { Test } from '@nestjs/testing';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('responde con el contrato compartido de disponibilidad', () => {
    const response = controller.live();

    expect(liveHealthResponseSchema.safeParse(response).success).toBe(true);
  });
});
