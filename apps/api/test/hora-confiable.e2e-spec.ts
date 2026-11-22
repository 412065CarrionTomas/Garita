import { SuspensionProcessor } from '../src/modules/subscriptions/suspension.processor';
import { syncBatchResponseSchema } from '@garita/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { CLOCK } from '../src/common/clock';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { QrService } from '../src/modules/checkpoints/qr.service';
import { ShiftCredentialService } from '../src/modules/sync/shift-credential.service';

describe('HU-14 integración de hora confiable', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService['systemPrisma'];
  let qrService: QrService;
  let shiftCredentialService: ShiftCredentialService;
  let northGuardId: string;
  let northAdminId: string;
  let siteId: string;
  let testCheckpointId: string;
  const guardUid = `hu14-${randomUUID()}`;
  const guardAuth = { Authorization: 'Bearer token-guard' };
  const createdShiftIds: string[] = [];
  let testNow = new Date('2026-10-19T12:00:00.000Z');
  const defaultLocation = {
    status: 'ok',
    latitude: -34.6037,
    longitude: -58.3816,
    accuracyMeters: 5,
    simulation: 'not_simulated',
    takenAt: testNow.toISOString(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue({
        verifyIdToken: (token: string) =>
          token === 'token-guard'
            ? Promise.resolve({ uid: guardUid })
            : Promise.reject(new Error('Token inválido')),
      })
      .overrideProvider(CLOCK)
      .useValue({ now: () => testNow })
      .overrideProvider(SuspensionProcessor)
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService).systemPrisma;
    qrService = app.get(QrService);
    shiftCredentialService = app.get(ShiftCredentialService);
    const guard = await prisma.user.create({
      data: {
        companyId: 'norte-company',
        firebaseUid: guardUid,
        email: `${guardUid}@test.invalid`,
        firstName: 'Clock',
        lastName: 'Test',
        role: 'guard',
        status: 'active',
      },
    });
    northGuardId = guard.id;
    northAdminId = (
      await prisma.user.findUniqueOrThrow({ where: { firebaseUid: 'seed-norte-admin' } })
    ).id;
    siteId = (
      await prisma.site.findFirstOrThrow({
        where: { companyId: 'norte-company', name: 'Predio A' },
      })
    ).id;
    testCheckpointId = (
      await prisma.checkpoint.create({
        data: {
          companyId: 'norte-company',
          siteId,
          name: guardUid,
          latitude: -34.6037,
          longitude: -58.3816,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.shiftCredential.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
    await prisma.syncBatch.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
    await prisma.shiftSyncState.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
    await prisma.checkpointRecord.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
    await prisma.shiftEvent.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
    await prisma.shiftAssignment.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
    await prisma.shift.deleteMany({ where: { id: { in: createdShiftIds } } });
    await prisma.checkpoint.delete({ where: { id: testCheckpointId } });
    await prisma.user.delete({ where: { id: northGuardId } });
    await app.close();
  });

  async function createTestShift(_options: { status: 'in_progress' }) {
    const startsAt = new Date(Date.UTC(2026, 9, 20 + createdShiftIds.length, 1));
    const endsAt = new Date(startsAt.getTime() + 4 * 3600000);
    testNow = new Date(endsAt.getTime() + 1800000);
    const shift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId,
        startsAt,
        endsAt,
        serviceDate: startsAt,
        status: 'in_progress',
        startedAt: startsAt,
        createdById: northAdminId,
        assignments: {
          create: {
            guardId: northGuardId,
            startsAt,
            endsAt,
            assignedById: northAdminId,
            active: true,
            isCurrent: true,
          },
        },
      },
    });
    createdShiftIds.push(shift.id);
    return shift;
  }
  describe('HU-14 hora confiable (ID-168/ID-169)', () => {
    afterEach(async () => {
      await prisma.shift.updateMany({
        where: { id: { in: createdShiftIds }, status: 'in_progress' },
        data: { status: 'closed' },
      });
    });
    it('keeps a future trusted close with its time flag and original device time', async () => {
      const shift = await createTestShift({ status: 'in_progress' });
      const assignment = await prisma.shiftAssignment.findFirstOrThrow({
        where: { shiftId: shift.id, isCurrent: true },
      });
      const { token } = await shiftCredentialService.issueCredential({
        shiftId: shift.id,
        assignmentId: assignment.id,
        userId: northGuardId,
        companyId: 'norte-company',
        scheduledEnd: shift.endsAt,
      });
      const trustedAt = new Date(testNow.getTime() + 1000).toISOString();
      const deviceTime = shift.startsAt.toISOString();
      const eventId = randomUUID();
      const body = {
        shiftId: shift.id,
        pendingCount: 0,
        syncedUntil: null,
        events: [
          {
            type: 'shift_close',
            payload: {
              eventId,
              occurredAtDevice: deviceTime,
              location: defaultLocation,
              clock: {
                deviceTime,
                trustedAt,
                elapsedMs: 1000,
                bootId: 'close-boot',
                timeStatus: 'verified',
                referenceOffsetMs: 0,
              },
            },
          },
        ],
      };
      const response = await request(app.getHttpServer())
        .post('/api/v1/sincronizacion/eventos')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(200);
      expect(syncBatchResponseSchema.parse(response.body).results).toMatchObject([
        { status: 'accepted' },
      ]);
      const event = await prisma.shiftEvent.findUniqueOrThrow({
        where: { deviceEventId: eventId },
      });
      expect(event.occurredAtDevice?.toISOString()).toBe(deviceTime);
      expect(event.trustedAt?.toISOString()).toBe(trustedAt);
      expect(event.occurredAt.toISOString()).toBe(trustedAt);
      expect(event.response).toMatchObject({
        timeFlags: [{ type: 'time_altered', severity: 'grave', reason: 'trusted_time_in_future' }],
      });
      const batch = await prisma.syncBatch.findFirstOrThrow({ where: { shiftId: shift.id } });
      expect(batch.syncedUntil?.toISOString()).toBe(trustedAt);
    });
    it('GET /hora is public and never accepts a reference supplied by the caller', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hora?serverTime=2099-01-01T00:00:00Z')
        .expect(200);
      expect(response.body).toEqual({ serverTime: testNow.toISOString() });
      await request(app.getHttpServer())
        .post('/api/v1/hora')
        .set(guardAuth)
        .send({ serverTime: '2099-01-01T00:00:00Z' })
        .expect(404);
    });

    it.each(['altered', 'recalculated', 'future', 'unverifiable', 'legacy'] as const)(
      'persists and evaluates %s clock idempotently',
      async (scenario) => {
        const shift = await createTestShift({ status: 'in_progress' });
        const assignment = await prisma.shiftAssignment.findFirstOrThrow({
          where: { shiftId: shift.id, isCurrent: true },
        });
        const { token } = await shiftCredentialService.issueCredential({
          shiftId: shift.id,
          assignmentId: assignment.id,
          userId: northGuardId,
          companyId: 'norte-company',
          scheduledEnd: shift.endsAt,
        });
        const trustedAt =
          scenario === 'future'
            ? new Date(testNow.getTime() + 1000).toISOString()
            : new Date(shift.startsAt.getTime() + 600000).toISOString();
        const deviceTime =
          scenario === 'altered'
            ? new Date(Date.parse(trustedAt) + 10800000).toISOString()
            : trustedAt;
        const recordId = randomUUID();
        const body = {
          shiftId: shift.id,
          pendingCount: 0,
          syncedUntil: null,
          events: [
            {
              type: 'checkpoint_record',
              payload: {
                recordId,
                shiftId: shift.id,
                method: 'qr',
                scannedValue: qrService.createPayload(testCheckpointId, 1),
                occurredAtDevice: deviceTime,
                location: defaultLocation,
                phoneNfc: 'unsupported',
                ...(scenario === 'legacy'
                  ? {}
                  : {
                      clock: {
                        deviceTime,
                        trustedAt: scenario === 'unverifiable' ? null : trustedAt,
                        elapsedMs: 1000,
                        bootId: 'e2e-boot',
                        referenceOffsetMs: 0,
                        timeStatus:
                          scenario === 'recalculated'
                            ? 'recalculated'
                            : scenario === 'unverifiable'
                              ? 'unverifiable'
                              : 'verified',
                      },
                    }),
              },
            },
          ],
        };
        const response = await request(app.getHttpServer())
          .post('/api/v1/sincronizacion/eventos')
          .set('Authorization', `Bearer ${token}`)
          .send(body)
          .expect(200);
        expect(response.body).toMatchObject({
          serverTime: testNow.toISOString(),
          results: [{ status: 'accepted', outcome: { result: 'recorded' } }],
        });
        const record = await prisma.checkpointRecord.findUniqueOrThrow({
          where: { recordId },
          include: { flags: true },
        });
        expect(record.occurredAtDevice.toISOString()).toBe(deviceTime);
        expect(record.trustedAt?.toISOString() ?? null).toBe(
          ['legacy', 'unverifiable'].includes(scenario) ? null : trustedAt,
        );
        const timeFlags = record.flags.filter(
          ({ type }) => type === 'time_altered' || type === 'time_unverifiable',
        );
        expect(timeFlags.map(({ type }) => type)).toEqual(
          scenario === 'altered' || scenario === 'future'
            ? ['time_altered']
            : scenario === 'unverifiable'
              ? ['time_unverifiable']
              : [],
        );
        const replay = await request(app.getHttpServer())
          .post('/api/v1/sincronizacion/eventos')
          .set('Authorization', `Bearer ${token}`)
          .send(body)
          .expect(200);
        expect(syncBatchResponseSchema.parse(replay.body).results).toEqual([
          { status: 'duplicate', eventId: recordId },
        ]);
        expect(await prisma.checkpointRecord.count({ where: { recordId } })).toBe(1);
      },
    );
  });
});
