import { ForbiddenException } from '@nestjs/common';
import { ClientIncidentsReader } from './client-incidents.reader';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { z } from 'zod';

it('solo proyecta incidentes visibles y su nota del cliente', async () => {
  let query: unknown;
  const findMany = jest.fn((args: unknown) => {
    query = args;
    return Promise.resolve([
      { id: 'visible', type: 'intrusion', classifications: [{ clientNote: 'Nota pública' }] },
    ]);
  });
  const reader = new ClientIncidentsReader({
    systemPrisma: { incident: { findMany } },
  } as unknown as PrismaService);
  const user: AuthenticatedUser = {
    userId: 'client-user',
    companyId: 'norte',
    clientId: 'client-1',
    role: 'client',
    status: 'active',
  };
  await expect(reader.list(user)).resolves.toEqual([
    { id: 'visible', type: 'intrusion', clientNote: 'Nota pública' },
  ]);
  const parsed = z
    .object({
      where: z
        .object({
          companyId: z.string(),
          classificationStatus: z.string(),
          site: z.looseObject({ clientId: z.string() }),
        })
        .loose(),
      select: z.record(z.string(), z.unknown()),
    })
    .parse(query);
  expect(parsed.where.companyId).toBe('norte');
  expect(parsed.where.classificationStatus).toBe('client_visible');
  expect(parsed.where.site.clientId).toBe('client-1');
  expect(parsed.select).not.toHaveProperty('internalComment');
  await expect(reader.list({ ...user, role: 'supervisor' })).rejects.toBeInstanceOf(
    ForbiddenException,
  );
});
