import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { TenantContext } from '../src/modules/auth/tenant-context';
import { TenantResourceService } from '../src/modules/auth/tenant-resource.service';
import type { AuthenticatedUser } from '../src/modules/auth/auth.types';
import type { Env } from '../src/config/env';
import { IncidentsService } from '../src/modules/incidents/incidents.service';
import { IncidentClassificationService } from '../src/modules/incidents/incident-classification.service';
import type { PhotoStoragePort } from '../src/modules/incidents/photo-storage.port';
import type { NotificationsPort } from '../src/common/ports/notifications.port';
import type { RealtimePort } from '../src/common/ports/realtime.port';
import type { ShiftCredentialPayload } from '../src/modules/sync/shift-credential.service';

describe('WC incident regressions (PostgreSQL, external storage mocked)', () => {
  const context = new TenantContext();
  const prisma = new PrismaService(
    new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    context,
  );
  const db = prisma.systemPrisma;
  let now = new Date('2026-11-13T12:00:00Z');
  const clock = { now: () => now };
  const storage = {
    authorizeUpload: jest.fn((companyId: string, incidentId: string) =>
      Promise.resolve({
        cloudName: 'fake',
        apiKey: 'fake',
        signature: 'fake',
        timestamp: 1,
        type: 'authenticated' as const,
        uploadUrl: 'https://example.invalid/upload',
        publicId: `incidentes/${companyId}/${incidentId}/${randomUUID()}`,
      }),
    ),
    inspectUpload: jest.fn(() => Promise.resolve({ width: 100, height: 100, bytes: 1000 })),
    signedUrl: () => 'https://example.invalid/photo',
  } satisfies PhotoStoragePort;
  const service = new IncidentsService(
    prisma,
    clock,
    {} as NotificationsPort,
    {} as RealtimePort,
    storage,
  );
  const classification = new IncidentClassificationService(
    prisma,
    new TenantResourceService(prisma, context),
    clock,
    storage,
  );
  const companyId = `wc-${randomUUID()}`;
  let credential: ShiftCredentialPayload;
  let admin: AuthenticatedUser;
  let siteId: string;

  beforeAll(async () => {
    await db.company.create({
      data: { id: companyId, name: 'WC test', timezone: 'America/Argentina/Buenos_Aires' },
    });
    const user = await db.user.create({
      data: {
        companyId,
        firebaseUid: companyId,
        email: `${companyId}@example.invalid`,
        firstName: 'Test',
        lastName: 'WC',
        role: 'admin',
        status: 'active',
      },
    });
    admin = { userId: user.id, companyId, role: 'admin', status: 'active' };
    const client = await db.client.create({
      data: {
        companyId,
        name: 'WC',
        contactName: 'WC',
        phone: '123',
        email: `${companyId}@example.invalid`,
      },
    });
    const site = await db.site.create({
      data: {
        companyId,
        clientId: client.id,
        name: 'WC',
        address: 'Test',
        latitude: 0,
        longitude: 0,
      },
    });
    siteId = site.id;
    const shift = await db.shift.create({
      data: {
        companyId,
        siteId,
        createdById: user.id,
        startsAt: now,
        endsAt: new Date(now.getTime() + 3_600_000),
        serviceDate: now,
        assignments: {
          create: {
            guardId: user.id,
            assignedById: user.id,
            startsAt: now,
            endsAt: new Date(now.getTime() + 3_600_000),
          },
        },
      },
      include: { assignments: true },
    });
    const assignment = shift.assignments[0];
    if (!assignment) throw new Error('Missing fixture assignment');
    credential = {
      companyId,
      userId: user.id,
      shiftId: shift.id,
      assignmentId: assignment.id,
      exp: 2_000_000_000,
    };
  });
  afterAll(async () => {
    await db.shift.deleteMany({ where: { companyId } });
    await db.site.deleteMany({ where: { companyId } });
    await db.client.deleteMany({ where: { companyId } });
    await db.user.deleteMany({ where: { companyId } });
    await db.company.delete({ where: { id: companyId } });
    await prisma.onModuleDestroy();
  });
  afterEach(async () => {
    await db.incident.deleteMany({ where: { companyId } });
  });

  async function incident(occurredAtDevice = now, trustedAt: Date | null = null) {
    const row = await db.incident.create({
      data: {
        companyId,
        siteId,
        shiftId: credential.shiftId,
        assignmentId: credential.assignmentId,
        guardId: credential.userId,
        incidentId: randomUUID(),
        type: 'intrusion',
        occurredAtDevice,
        trustedAt,
        locationStatus: 'unverifiable',
        simulation: 'unavailable',
      },
    });
    return row;
  }

  it('replaces unused authorizations so failed uploads cannot exhaust the five-photo quota', async () => {
    const row = await incident();
    const authorizations = [];
    for (let attempt = 0; attempt < 8; attempt++)
      authorizations.push(await service.authorizePhoto(row.incidentId, credential));
    const first = authorizations[0];
    const last = authorizations[7];
    if (!first || !last) throw new Error('Missing fixture authorizations');
    expect(await db.incidentPhotoAuthorization.count({ where: { incidentId: row.id } })).toBe(5);
    await expect(
      service.registerPhoto(row.incidentId, credential, first.publicId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.registerPhoto(row.incidentId, credential, last.publicId),
    ).resolves.toHaveProperty('id');
  });

  it('requires a live authorization for that incident and rejects expired and foreign public IDs', async () => {
    const row = await incident();
    const authorization = await service.authorizePhoto(row.incidentId, credential);
    await expect(
      service.registerPhoto(row.incidentId, credential, 'incidentes/foreign/photo'),
    ).rejects.toBeInstanceOf(NotFoundException);
    now = new Date(now.getTime() + 15 * 60_000);
    await expect(
      service.registerPhoto(row.incidentId, credential, authorization.publicId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps at most five actual photos when confirmations compete for the last slot', async () => {
    const row = await incident();
    const a = await service.authorizePhoto(row.incidentId, credential);
    const b = await service.authorizePhoto(row.incidentId, credential);
    await db.incidentPhoto.createMany({
      data: Array.from({ length: 4 }, () => ({
        incidentId: row.id,
        cloudinaryPublicId: randomUUID(),
        width: 100,
        height: 100,
        bytes: 1000,
      })),
    });
    const results = await Promise.allSettled([
      service.registerPhoto(row.incidentId, credential, a.publicId),
      service.registerPhoto(row.incidentId, credential, b.publicId),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.incidentPhoto.count({ where: { incidentId: row.id } })).toBe(5);
    await expect(service.authorizePhoto(row.incidentId, credential)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rechecks authorization validity after inspecting the remote upload', async () => {
    const row = await incident();
    const authorization = await service.authorizePhoto(row.incidentId, credential);
    storage.inspectUpload.mockImplementationOnce(() => {
      now = new Date(now.getTime() + 15 * 60_000);
      return Promise.resolve({ width: 100, height: 100, bytes: 1000 });
    });
    await expect(
      service.registerPhoto(row.incidentId, credential, authorization.publicId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await db.incidentPhoto.count({ where: { incidentId: row.id } })).toBe(0);
  });

  it.each([
    [
      'America/Argentina/Buenos_Aires',
      '2026-11-13',
      '2026-11-13T03:00:00Z',
      '2026-11-14T03:00:00Z',
    ],
    ['America/New_York', '2026-03-08', '2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z'],
  ])(
    'filters occurrence time by the complete local day in %s, including DST',
    async (timezone, day, start, end) => {
      await db.company.update({ where: { id: companyId }, data: { timezone } });
      const first = await incident(new Date('2020-01-01T00:00:00Z'), new Date(start));
      const last = await incident(new Date(Date.parse(end) - 1));
      await incident(new Date(Date.parse(start) - 1));
      await incident(new Date(end));
      await incident(new Date(start), new Date(end));
      const response = await context.run({ correlationId: 'wc', user: admin }, () =>
        classification.list(admin, { desde: day, hasta: day, pagina: 1 }),
      );
      expect(response.items.map((item) => item.id).sort()).toEqual([first.id, last.id].sort());
      expect(response.total).toBe(2);
    },
  );
});
