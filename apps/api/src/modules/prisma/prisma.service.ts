import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';

import type { Env } from '../../config/env';
import { PrismaClient } from '../../generated/prisma/client';
import { TenantContext } from '../auth/tenant-context';
import { createTenantPrismaClient } from './tenant-prisma';

/**
 * Cliente de Prisma compartido. Solo lo usan los servicios del módulo dueño de cada tabla;
 * los demás módulos acceden a esos datos a través del servicio exportado por ese módulo.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly systemPrisma: PrismaClient;
  readonly tenantPrisma: ReturnType<typeof createTenantPrismaClient>;

  constructor(config: ConfigService<Env, true>, context: TenantContext) {
    this.systemPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL', { infer: true }) }),
    });
    this.tenantPrisma = createTenantPrismaClient(this.systemPrisma, context);
  }

  async onModuleDestroy(): Promise<void> {
    await this.systemPrisma.$disconnect();
  }
}
