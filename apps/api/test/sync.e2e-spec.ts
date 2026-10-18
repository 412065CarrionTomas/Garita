import {
  startShiftResponseSchema,
  syncBatchResponseSchema,
  connectionNoticeResponseSchema,
} from '@garita/shared';
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

describe('Sincronización sin señal HU-13 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService['systemPrisma'];
  let qrService: QrService;
  let shiftCredentialService: ShiftCredentialService;

  let northSiteId: string;
  let northAdminId: string;
  let northGuardId: string;
  let testCheckpointId: string;
  let testRoundId: string;
  let testRoundVersionId: string;

  const createdShiftIds: string[] = [];
  const createdCheckpointIds: string[] = [];
  const createdRoundIds: string[] = [];
  const createdRoundVersionIds: string[] = [];

  const guardAuth = { Authorization: 'Bearer token-guard' };
  const defaultLocation = {
    status: 'ok' as const,
    latitude: -34.6037,
    longitude: -58.3816,
    accuracyMeters: 5,
    simulation: 'not_simulated' as const,
    takenAt: '2026-10-20T02:00:00.000Z',
  };

  let testNow = new Date('2026-10-20T06:00:00.000Z');
  let shiftCounter = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue({
        verifyIdToken: (token: string) => {
          if (token === 'token-admin') return Promise.resolve({ uid: 'seed-norte-admin' });
          if (token === 'token-guard') return Promise.resolve({ uid: 'seed-norte-guard' });
          return Promise.reject(new Error('Token inválido'));
        },
        setDisabled: jest.fn(() => Promise.resolve()),
        revokeRefreshTokens: jest.fn(() => Promise.resolve()),
        createDisabledUser: jest.fn((email: string) => Promise.resolve({ uid: email })),
        deleteUser: jest.fn(() => Promise.resolve()),
        generatePasswordResetLink: jest.fn((email: string) => Promise.resolve(email)),
      })
      .overrideProvider(CLOCK)
      .useValue({ now: () => testNow })
      .compile();

    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();

    prisma = app.get(PrismaService).systemPrisma;
    qrService = app.get(QrService);
    shiftCredentialService = app.get(ShiftCredentialService);

    const northClient = await prisma.client.findUniqueOrThrow({
      where: { companyId_name: { companyId: 'norte-company', name: 'Cliente norte' } },
    });
    const northSite = await prisma.site.findUniqueOrThrow({
      where: { clientId_name: { clientId: northClient.id, name: 'Predio A' } },
    });
    northSiteId = northSite.id;

    const northAdmin = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-admin' },
    });
    northAdminId = northAdmin.id;

    const northGuard = await prisma.user.findUniqueOrThrow({
      where: { firebaseUid: 'seed-norte-guard' },
    });
    northGuardId = northGuard.id;

    // Limpiar asignaciones previas huérfanas de pruebas anteriores para evitar solapamientos
    await prisma.shiftAssignment.deleteMany({
      where: {
        guardId: northGuardId,
        startsAt: {
          gte: new Date('2026-10-14T00:00:00.000Z'),
          lt: new Date('2026-11-01T00:00:00.000Z'),
        },
      },
    });

    // Crear un checkpoint de prueba con QR
    const cp = await prisma.checkpoint.create({
      data: {
        companyId: 'norte-company',
        siteId: northSiteId,
        name: `Punto HU-13 E2E ${randomUUID().slice(0, 8)}`,
        latitude: -34.6037,
        longitude: -58.3816,
        qrVersion: 1,
      },
    });
    testCheckpointId = cp.id;
    createdCheckpointIds.push(cp.id);

    // Crear una ronda con versión que incluya el checkpoint
    const round = await prisma.round.create({
      data: {
        companyId: 'norte-company',
        siteId: northSiteId,
        name: `Ronda HU-13 E2E ${randomUUID().slice(0, 8)}`,
        versions: {
          create: {
            versionNumber: 1,
            frequencyMinutes: 60,
            graceMinutes: 15,
            windowStartLocal: '00:00',
            windowEndLocal: '23:59',
            createdById: northAdminId,
            checkpoints: {
              create: [{ companyId: 'norte-company', checkpointId: cp.id, position: 0 }],
            },
          },
        },
      },
      include: { versions: true },
    });
    testRoundId = round.id;
    createdRoundIds.push(round.id);

    const version = round.versions[0];
    if (!version) throw new Error('No se pudo crear la versión de ronda');
    testRoundVersionId = version.id;
    createdRoundVersionIds.push(version.id);

    await prisma.round.update({
      where: { id: round.id },
      data: { currentVersionId: version.id },
    });
  });

  afterAll(async () => {
    // Restaurar el estado del guardia por si algún test lo modificó
    await prisma.user.update({
      where: { id: northGuardId },
      data: { status: 'active' },
    });

    if (createdShiftIds.length > 0) {
      await prisma.connectionNotice.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
      await prisma.syncBatch.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
      await prisma.shiftSyncState.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
      await prisma.shiftCredential.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
      await prisma.checkpointRecord.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
      await prisma.invalidScanAttempt.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
      await prisma.shiftRound.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
      await prisma.shiftEvent.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
      await prisma.shiftAssignment.deleteMany({ where: { shiftId: { in: createdShiftIds } } });
      await prisma.shift.deleteMany({ where: { id: { in: createdShiftIds } } });
    }

    if (createdRoundVersionIds.length > 0) {
      await prisma.roundVersionCheckpoint.deleteMany({
        where: { roundVersionId: { in: createdRoundVersionIds } },
      });
      await prisma.round.updateMany({
        where: { id: { in: createdRoundIds } },
        data: { currentVersionId: null },
      });
      await prisma.roundVersion.deleteMany({
        where: { id: { in: createdRoundVersionIds } },
      });
    }

    if (createdRoundIds.length > 0) {
      await prisma.round.deleteMany({ where: { id: { in: createdRoundIds } } });
    }

    if (createdCheckpointIds.length > 0) {
      await prisma.checkpoint.deleteMany({ where: { id: { in: createdCheckpointIds } } });
    }

    await app.close();
  });

  async function createTestShift(
    options: {
      status?: 'scheduled' | 'in_progress' | 'auto_closed' | 'closed';
      startsAt?: Date;
      endsAt?: Date;
    } = {},
  ) {
    shiftCounter++;
    const day = 20 + shiftCounter;
    const defaultStartsAt = new Date(Date.UTC(2026, 9, day, 1, 0, 0));
    const defaultEndsAt = new Date(Date.UTC(2026, 9, day, 5, 0, 0));

    const startsAt = options.startsAt ?? defaultStartsAt;
    const endsAt =
      options.endsAt ??
      (options.startsAt ? new Date(options.startsAt.getTime() + 4 * 3600 * 1000) : defaultEndsAt);
    const status = options.status ?? 'scheduled';

    testNow = new Date(endsAt.getTime() + 30 * 60 * 1000);

    const shift = await prisma.shift.create({
      data: {
        companyId: 'norte-company',
        siteId: northSiteId,
        startsAt,
        endsAt,
        serviceDate: new Date(Date.UTC(2026, 9, day, 0, 0, 0)),
        status,
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
        rounds: {
          create: {
            roundId: testRoundId,
            roundVersionId: testRoundVersionId,
          },
        },
      },
    });

    createdShiftIds.push(shift.id);
    return shift;
  }

  describe('ID-158 — Emisión y Replay de Credencial de Turno', () => {
    it('inicia el turno devolviendo la credencial firmada y repetir el inicio devuelve la misma credencial', async () => {
      const client = request(app.getHttpServer());
      const shift = await createTestShift();
      testNow = new Date(shift.startsAt.getTime());

      const startBody = {
        eventId: randomUUID(),
        occurredAtDevice: shift.startsAt.toISOString(),
        location: { ...defaultLocation, takenAt: shift.startsAt.toISOString() },
      };

      const startRes = await client
        .post(`/api/v1/turnos/${shift.id}/iniciar`)
        .set(guardAuth)
        .send(startBody)
        .expect(201);

      const parsedStart = startShiftResponseSchema.parse(startRes.body);
      expect(parsedStart.status).toBe('in_progress');
      expect(parsedStart.credential).toBeDefined();
      expect(typeof parsedStart.credential?.token).toBe('string');
      expect(parsedStart.credential?.expiresAt).toBeDefined();

      // Verificar que el token firmado contiene los datos correctos
      if (!parsedStart.credential) {
        throw new Error('Credential was not returned');
      }
      const verified = await shiftCredentialService.verifyCredential(parsedStart.credential.token);
      expect(verified.valid).toBe(true);
      if (verified.valid) {
        expect(verified.payload.shiftId).toBe(shift.id);
        expect(verified.payload.userId).toBe(northGuardId);
        expect(verified.payload.companyId).toBe('norte-company');
      }

      // Validar que se persistió en ShiftCredential
      const credRecord = await prisma.shiftCredential.findFirst({
        where: { shiftId: shift.id, userId: northGuardId },
      });
      expect(credRecord).not.toBeNull();
      expect(credRecord?.shiftId).toBe(shift.id);
      expect(credRecord?.userId).toBe(northGuardId);
      expect(credRecord?.tokenHash).toBeDefined();
      expect(credRecord?.expiresAt).toBeDefined();

      // Repetir el inicio (idempotencia) debe devolver exactamente la misma credencial
      const replayRes = await client
        .post(`/api/v1/turnos/${shift.id}/iniciar`)
        .set(guardAuth)
        .send(startBody)
        .expect(201);

      expect(replayRes.body).toEqual(startRes.body);
      const replayBody = replayRes.body as { credential?: { token?: string } };
      expect(replayBody.credential?.token).toBe(parsedStart.credential.token);
    });

    it('deniega endpoints protegidos normales si se presenta la credencial de turno (403 CREDENTIAL_SCOPE_NOT_ALLOWED)', async () => {
      const client = request(app.getHttpServer());
      const shift = await createTestShift();
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

      // Intentar usar la credencial de turno en un endpoint normal (ej. consultar estado del turno)
      const res = await client
        .get(`/api/v1/turnos/${shift.id}/estado`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(res.body).toMatchObject({
        code: 'CREDENTIAL_SCOPE_NOT_ALLOWED',
      });
    });

    it('deniega endpoints de sincronización sin credencial o con credencial inválida/alterada (401 INVALID_SHIFT_CREDENTIAL)', async () => {
      const client = request(app.getHttpServer());

      // 1. Sin cabecera Authorization
      const missingRes = await client
        .post('/api/v1/sincronizacion/eventos')
        .send({
          shiftId: 'any-shift',
          pendingCount: 0,
          syncedUntil: new Date().toISOString(),
          events: [],
        })
        .expect(401);
      expect(missingRes.body).toMatchObject({ code: 'INVALID_SHIFT_CREDENTIAL' });

      // 2. Token con firma alterada
      const tamperedRes = await client
        .post('/api/v1/sincronizacion/eventos')
        .set('Authorization', 'Bearer header.payload.firma_falsa_alterada')
        .send({
          shiftId: 'any-shift',
          pendingCount: 0,
          syncedUntil: new Date().toISOString(),
          events: [],
        })
        .expect(401);
      expect(tamperedRes.body).toMatchObject({ code: 'INVALID_SHIFT_CREDENTIAL' });

      // 3. Token con fecha de expiración en el pasado
      const expiredPayload = {
        shiftId: 'non-existent',
        assignmentId: 'non-existent',
        userId: northGuardId,
        companyId: 'norte-company',
        exp: Math.floor(Date.now() / 1000) - 3600, // 1 hora atrás
      };
      const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
        'base64url',
      );
      const payloadB64 = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
      const signInput = `${headerB64}.${payloadB64}`;
      const sig = (await import('node:crypto'))
        .createHmac('sha256', '8210af9ef218e1b5a488fdf286be93dd2629390b2dfc7138853ead58b50d6e00')
        .update(signInput)
        .digest('base64url');
      const expiredToken = `${signInput}.${sig}`;

      const expiredRes = await client
        .post('/api/v1/sincronizacion/eventos')
        .set('Authorization', `Bearer ${expiredToken}`)
        .send({
          shiftId: 'any-shift',
          pendingCount: 0,
          syncedUntil: new Date().toISOString(),
          events: [],
        })
        .expect(401);
      expect(expiredRes.body).toMatchObject({ code: 'INVALID_SHIFT_CREDENTIAL' });
    });
  });

  describe('ID-159 — Sincronización por Lotes (POST /api/v1/sincronizacion/eventos)', () => {
    it('procesa lote con checkpoint_record y shift_close, registra SyncBatch y actualiza ShiftSyncState', async () => {
      const client = request(app.getHttpServer());
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

      const recordEventId = randomUUID();
      const closeEventId = randomUUID();
      const qrPayload = qrService.createPayload(testCheckpointId, 1);
      const recordTime = new Date(shift.startsAt.getTime() + 10 * 60 * 1000).toISOString();
      const closeTime = new Date(shift.startsAt.getTime() + 60 * 60 * 1000).toISOString();

      const batchReq = {
        shiftId: shift.id,
        pendingCount: 0,
        syncedUntil: closeTime,
        events: [
          {
            type: 'checkpoint_record' as const,
            payload: {
              recordId: recordEventId,
              shiftId: shift.id,
              method: 'qr' as const,
              scannedValue: qrPayload,
              occurredAtDevice: recordTime,
              location: { ...defaultLocation, takenAt: recordTime },
              phoneNfc: 'on' as const,
            },
          },
          {
            type: 'shift_close' as const,
            payload: {
              eventId: closeEventId,
              occurredAtDevice: closeTime,
              location: { ...defaultLocation, takenAt: closeTime },
              reason: 'Fin de turno',
            },
          },
        ],
      };

      const res = await client
        .post('/api/v1/sincronizacion/eventos')
        .set('Authorization', `Bearer ${token}`)
        .send(batchReq)
        .expect(200);

      const parsed = syncBatchResponseSchema.parse(res.body);
      expect(parsed.results).toHaveLength(2);
      expect(parsed.receivedAt).toBeDefined();
      expect(parsed.results[0]).toMatchObject({
        eventId: recordEventId,
        status: 'accepted',
        outcome: { result: 'recorded' },
      });
      expect(parsed.results[1]).toMatchObject({
        eventId: closeEventId,
        status: 'accepted',
        outcome: { status: 'closed' },
      });

      // Validar persistencia de SyncBatch
      const syncBatch = await prisma.syncBatch.findFirst({ where: { shiftId: shift.id } });
      expect(syncBatch).not.toBeNull();
      expect(syncBatch?.eventCount).toBe(2);
      expect(syncBatch?.pendingCount).toBe(0);

      // Validar actualización de ShiftSyncState
      const syncState = await prisma.shiftSyncState.findUnique({ where: { shiftId: shift.id } });
      expect(syncState).not.toBeNull();
      expect(syncState?.lastPendingCount).toBe(0);
      expect(syncState?.syncedUntil).toEqual(new Date(closeTime));

      // Validar que el turno quedó cerrado
      const updatedShift = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
      expect(updatedShift.status).toBe('closed');

      // Validar que se persistió el CheckpointRecord
      const record = await prisma.checkpointRecord.findUnique({
        where: { recordId: recordEventId },
      });
      expect(record).not.toBeNull();
      expect(record?.countsForCompliance).toBe(true);
    });

    it('reenviar el lote completo devuelve duplicate para todos los eventos y no crea registros duplicados (CA3, BDD 3)', async () => {
      const client = request(app.getHttpServer());
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

      const recordEventId = randomUUID();
      const qrPayload = qrService.createPayload(testCheckpointId, 1);
      const recordTime = new Date(shift.startsAt.getTime() + 10 * 60 * 1000).toISOString();

      const batchReq = {
        shiftId: shift.id,
        pendingCount: 0,
        syncedUntil: recordTime,
        events: [
          {
            type: 'checkpoint_record' as const,
            payload: {
              recordId: recordEventId,
              shiftId: shift.id,
              method: 'qr' as const,
              scannedValue: qrPayload,
              occurredAtDevice: recordTime,
              location: { ...defaultLocation, takenAt: recordTime },
              phoneNfc: 'on' as const,
            },
          },
        ],
      };

      // Primer envío -> accepted
      const res1 = await client
        .post('/api/v1/sincronizacion/eventos')
        .set('Authorization', `Bearer ${token}`)
        .send(batchReq)
        .expect(200);
      const res1Body = res1.body as { results: { status: string }[] };
      expect(res1Body.results[0]?.status).toBe('accepted');

      const countBefore = await prisma.checkpointRecord.count({
        where: { recordId: recordEventId },
      });
      expect(countBefore).toBe(1);

      // Reenvío exacto -> duplicate
      const res2 = await client
        .post('/api/v1/sincronizacion/eventos')
        .set('Authorization', `Bearer ${token}`)
        .send(batchReq)
        .expect(200);

      const parsed2 = syncBatchResponseSchema.parse(res2.body);
      expect(parsed2.results[0]?.status).toBe('duplicate');
      expect(parsed2.results[0]?.eventId).toBe(recordEventId);

      // No se creó duplicado en BD
      const countAfter = await prisma.checkpointRecord.count({
        where: { recordId: recordEventId },
      });
      expect(countAfter).toBe(1);
    });

    it('rechaza un cierre reenviado con el mismo eventId y contenido distinto', async () => {
      const client = request(app.getHttpServer());
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
      const eventId = randomUUID();
      const closePayload = {
        eventId,
        occurredAtDevice: new Date(shift.startsAt.getTime() + 60 * 60 * 1000).toISOString(),
        location: {
          ...defaultLocation,
          takenAt: new Date(shift.startsAt.getTime() + 60 * 60 * 1000).toISOString(),
        },
        reason: 'Fin de turno',
      };
      const sendClose = (payload: typeof closePayload) =>
        client
          .post('/api/v1/sincronizacion/eventos')
          .set('Authorization', `Bearer ${token}`)
          .send({
            shiftId: shift.id,
            pendingCount: 0,
            syncedUntil: null,
            events: [{ type: 'shift_close', payload }],
          });

      const first = await sendClose(closePayload).expect(200);
      const firstResults = syncBatchResponseSchema.parse(first.body).results;
      expect(firstResults[0]).toMatchObject({ status: 'accepted', eventId });
      const identical = await sendClose(closePayload).expect(200);
      const identicalResults = syncBatchResponseSchema.parse(identical.body).results;
      expect(identicalResults[0]).toMatchObject({ status: 'duplicate', eventId });
      const altered = await sendClose({ ...closePayload, reason: 'Cierre alterado' }).expect(200);
      const alteredResults = syncBatchResponseSchema.parse(altered.body).results;
      expect(alteredResults[0]).toMatchObject({
        status: 'rejected',
        eventId,
        reason: 'event_id_conflict',
      });
    });

    it('aísla fallos: evento con conflicto y de otro turno se rechazan sin frenar al evento válido', async () => {
      const client = request(app.getHttpServer());
      const shift = await createTestShift({ status: 'in_progress' });
      const otherShift = await createTestShift({ status: 'in_progress' });
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

      const validRecordId = randomUUID();
      const otherShiftRecordId = randomUUID();
      const conflictRecordId = randomUUID();
      const qrPayload = qrService.createPayload(testCheckpointId, 1);
      const recordTime = new Date(shift.startsAt.getTime() + 10 * 60 * 1000).toISOString();

      // Pre-crear un registro con conflictRecordId para forzar event_id_conflict con requestHash diferente
      await prisma.checkpointRecord.create({
        data: {
          recordId: conflictRecordId,
          companyId: 'norte-company',
          shiftId: shift.id,
          assignmentId: assignment.id,
          checkpointId: testCheckpointId,
          method: 'qr',
          occurredAtDevice: new Date(shift.startsAt.getTime() + 5 * 60 * 1000),
          locationStatus: 'ok',
          latitude: -34.6037,
          longitude: -58.3816,
          simulation: 'not_simulated',
          phoneNfc: 'on',
          countedFor: [],
          requestHash: 'hash-original-diferente',
        },
      });

      const batchReq = {
        shiftId: shift.id,
        pendingCount: 0,
        syncedUntil: recordTime,
        events: [
          // 1. Válido
          {
            type: 'checkpoint_record' as const,
            payload: {
              recordId: validRecordId,
              shiftId: shift.id,
              method: 'qr' as const,
              scannedValue: qrPayload,
              occurredAtDevice: recordTime,
              location: { ...defaultLocation, takenAt: recordTime },
              phoneNfc: 'on' as const,
            },
          },
          // 2. Turno distinto al de la credencial
          {
            type: 'checkpoint_record' as const,
            payload: {
              recordId: otherShiftRecordId,
              shiftId: otherShift.id,
              method: 'qr' as const,
              scannedValue: qrPayload,
              occurredAtDevice: recordTime,
              location: { ...defaultLocation, takenAt: recordTime },
              phoneNfc: 'on' as const,
            },
          },
          // 3. Conflicto de ID de registro con contenido distinto
          {
            type: 'checkpoint_record' as const,
            payload: {
              recordId: conflictRecordId,
              shiftId: shift.id,
              method: 'qr' as const,
              scannedValue: qrPayload,
              occurredAtDevice: recordTime,
              location: { ...defaultLocation, takenAt: recordTime },
              phoneNfc: 'on' as const,
            },
          },
        ],
      };

      const res = await client
        .post('/api/v1/sincronizacion/eventos')
        .set('Authorization', `Bearer ${token}`)
        .send(batchReq)
        .expect(200);

      const parsed = syncBatchResponseSchema.parse(res.body);
      expect(parsed.results).toHaveLength(3);

      // Evento 1 fue aceptado
      const r0 = parsed.results[0];
      expect(r0?.status).toBe('accepted');
      if (r0?.status === 'accepted') {
        expect(r0.outcome).toMatchObject({ result: 'recorded' });
      }

      // Evento 2 fue rechazado por no pertenecer al turno de la credencial
      const r1 = parsed.results[1];
      expect(r1?.status).toBe('rejected');
      if (r1?.status === 'rejected') {
        expect(r1.reason).toBe('not_in_credential_shift');
      }

      // Evento 3 fue rechazado por conflicto de ID
      const r2 = parsed.results[2];
      expect(r2?.status).toBe('rejected');
      if (r2?.status === 'rejected') {
        expect(r2.reason).toBe('event_id_conflict');
      }
    });

    it('vigilador desactivado DESPUÉS de iniciado el turno: la credencial sigue permitiendo sincronizar (CA10, BDD 5)', async () => {
      const client = request(app.getHttpServer());
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

      // Desactivar al vigilador en la base de datos (simulando baja administrativa durante el turno)
      await prisma.user.update({
        where: { id: northGuardId },
        data: { status: 'deactivated' },
      });

      const recordEventId = randomUUID();
      const qrPayload = qrService.createPayload(testCheckpointId, 1);
      const recordTime = new Date(shift.startsAt.getTime() + 10 * 60 * 1000).toISOString();

      const batchReq = {
        shiftId: shift.id,
        pendingCount: 0,
        syncedUntil: recordTime,
        events: [
          {
            type: 'checkpoint_record' as const,
            payload: {
              recordId: recordEventId,
              shiftId: shift.id,
              method: 'qr' as const,
              scannedValue: qrPayload,
              occurredAtDevice: recordTime,
              location: { ...defaultLocation, takenAt: recordTime },
              phoneNfc: 'on' as const,
            },
          },
        ],
      };

      // La sincronización debe ser aceptada normalmente
      const res = await client
        .post('/api/v1/sincronizacion/eventos')
        .set('Authorization', `Bearer ${token}`)
        .send(batchReq)
        .expect(200);

      const parsed = syncBatchResponseSchema.parse(res.body);
      expect(parsed.results[0]?.status).toBe('accepted');

      // Restaurar estado activo para los siguientes tests
      await prisma.user.update({
        where: { id: northGuardId },
        data: { status: 'active' },
      });
    });

    it('eventos sincronizados tras cierre automático: se aceptan y el cierre real pisa al automático (CA9)', async () => {
      const client = request(app.getHttpServer());
      // Turno en estado auto_closed
      const shift = await createTestShift({ status: 'auto_closed' });
      const assignment = await prisma.shiftAssignment.findFirstOrThrow({
        where: { shiftId: shift.id, isCurrent: true },
      });

      // Registrar cierre automático previo en ShiftEvent
      await prisma.shiftEvent.create({
        data: {
          companyId: 'norte-company',
          shiftId: shift.id,
          assignmentId: assignment.id,
          type: 'auto_close',
          occurredAt: new Date(shift.endsAt.getTime() + 30 * 60 * 1000),
          reason: 'max_duration_exceeded',
        },
      });

      const { token } = await shiftCredentialService.issueCredential({
        shiftId: shift.id,
        assignmentId: assignment.id,
        userId: northGuardId,
        companyId: 'norte-company',
        scheduledEnd: shift.endsAt,
      });

      const recordEventId = randomUUID();
      const closeEventId = randomUUID();
      const qrPayload = qrService.createPayload(testCheckpointId, 1);
      const recordTime = new Date(shift.startsAt.getTime() + 10 * 60 * 1000).toISOString();
      const closeTime = new Date(shift.endsAt.getTime() - 10 * 60 * 1000).toISOString();

      const batchReq = {
        shiftId: shift.id,
        pendingCount: 0,
        syncedUntil: closeTime,
        events: [
          {
            type: 'checkpoint_record' as const,
            payload: {
              recordId: recordEventId,
              shiftId: shift.id,
              method: 'qr' as const,
              scannedValue: qrPayload,
              occurredAtDevice: recordTime,
              location: { ...defaultLocation, takenAt: recordTime },
              phoneNfc: 'on' as const,
            },
          },
          {
            type: 'shift_close' as const,
            payload: {
              eventId: closeEventId,
              occurredAtDevice: closeTime,
              location: { ...defaultLocation, takenAt: closeTime },
              reason: 'Fin de turno',
            },
          },
        ],
      };

      const res = await client
        .post('/api/v1/sincronizacion/eventos')
        .set('Authorization', `Bearer ${token}`)
        .send(batchReq)
        .expect(200);

      const parsed = syncBatchResponseSchema.parse(res.body);
      expect(parsed.results[0]?.status).toBe('accepted');
      expect(parsed.results[1]?.status).toBe('accepted');

      // Validar que el CheckpointRecord cuenta para cumplimiento
      const record = await prisma.checkpointRecord.findUnique({
        where: { recordId: recordEventId },
      });
      expect(record?.countsForCompliance).toBe(true);

      // Validar que el turno pasó de auto_closed a closed (el cierre real pisó al automático)
      const updatedShift = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
      expect(updatedShift.status).toBe('closed');
    });

    it('eventos sincronizados tras cierre administrativo: se persisten pero con countsForCompliance = false', async () => {
      const client = request(app.getHttpServer());
      // Turno cerrado administrativamente
      const shift = await createTestShift({ status: 'closed' });
      const assignment = await prisma.shiftAssignment.findFirstOrThrow({
        where: { shiftId: shift.id, isCurrent: true },
      });

      // Evento de cierre administrativo a los 30 minutos de iniciar
      const adminCloseTime = new Date(shift.startsAt.getTime() + 30 * 60 * 1000);
      await prisma.shift.update({
        where: { id: shift.id },
        data: {
          closedBy: 'admin',
          closedAt: adminCloseTime,
          closeReason: 'force_closed_by_admin',
        },
      });
      await prisma.shiftEvent.create({
        data: {
          companyId: 'norte-company',
          shiftId: shift.id,
          assignmentId: assignment.id,
          type: 'admin_close',
          occurredAt: adminCloseTime,
          reason: 'force_closed_by_admin',
        },
      });

      const { token } = await shiftCredentialService.issueCredential({
        shiftId: shift.id,
        assignmentId: assignment.id,
        userId: northGuardId,
        companyId: 'norte-company',
        scheduledEnd: shift.endsAt,
      });

      const recordEventId = randomUUID();
      const qrPayload = qrService.createPayload(testCheckpointId, 1);
      // Marca con hora posterior al cierre administrativo (a los 60 minutos)
      const lateRecordTime = new Date(shift.startsAt.getTime() + 60 * 60 * 1000).toISOString();

      const batchReq = {
        shiftId: shift.id,
        pendingCount: 0,
        syncedUntil: lateRecordTime,
        events: [
          {
            type: 'checkpoint_record' as const,
            payload: {
              recordId: recordEventId,
              shiftId: shift.id,
              method: 'qr' as const,
              scannedValue: qrPayload,
              occurredAtDevice: lateRecordTime,
              location: { ...defaultLocation, takenAt: lateRecordTime },
              phoneNfc: 'on' as const,
            },
          },
        ],
      };

      const res = await client
        .post('/api/v1/sincronizacion/eventos')
        .set('Authorization', `Bearer ${token}`)
        .send(batchReq)
        .expect(200);

      const parsed = syncBatchResponseSchema.parse(res.body);
      expect(parsed.results[0]?.status).toBe('accepted');

      // Validar que se guardó con countsForCompliance = false
      const record = await prisma.checkpointRecord.findUnique({
        where: { recordId: recordEventId },
      });
      expect(record).not.toBeNull();
      expect(record?.countsForCompliance).toBe(false);
    });
  });

  describe('ID-160 — Avisos de Conexión y Monotonía de ShiftSyncState', () => {
    it('guarda aviso de conexión, actualiza ShiftSyncState y mantiene monotonía de syncedUntil', async () => {
      const client = request(app.getHttpServer());
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

      const time1 = new Date(shift.startsAt.getTime() + 60 * 60 * 1000).toISOString();
      const timeOlder = new Date(shift.startsAt.getTime() + 30 * 60 * 1000).toISOString();
      const timeNewer = new Date(shift.startsAt.getTime() + 120 * 60 * 1000).toISOString();

      // Primer aviso con syncedUntil = time1
      const notice1 = {
        shiftId: shift.id,
        sentAtDevice: time1,
        pendingCount: 5,
        syncedUntil: time1,
      };

      const res1 = await client
        .post('/api/v1/avisos-conexion')
        .set('Authorization', `Bearer ${token}`)
        .send(notice1)
        .expect(200);

      const parsed1 = connectionNoticeResponseSchema.parse(res1.body);
      expect(parsed1.receivedAt).toBeDefined();

      const state1 = await prisma.shiftSyncState.findUnique({ where: { shiftId: shift.id } });
      expect(state1?.lastPendingCount).toBe(5);
      expect(state1?.syncedUntil).toEqual(new Date(time1));

      // Segundo aviso que llega desordenado con syncedUntil más antiguo
      const notice2 = {
        shiftId: shift.id,
        sentAtDevice: timeOlder,
        pendingCount: 3,
        syncedUntil: timeOlder,
      };

      const res2 = await client
        .post('/api/v1/avisos-conexion')
        .set('Authorization', `Bearer ${token}`)
        .send(notice2)
        .expect(200);

      const parsed2 = connectionNoticeResponseSchema.parse(res2.body);
      expect(parsed2.receivedAt).toBeDefined();

      const state2 = await prisma.shiftSyncState.findUnique({ where: { shiftId: shift.id } });
      expect(state2?.lastPendingCount).toBe(3);
      // syncedUntil NO retrocedió: sigue en time1
      expect(state2?.syncedUntil).toEqual(new Date(time1));

      // Tercer aviso con syncedUntil más nuevo
      const notice3 = {
        shiftId: shift.id,
        sentAtDevice: timeNewer,
        pendingCount: 1,
        syncedUntil: timeNewer,
      };

      await client
        .post('/api/v1/avisos-conexion')
        .set('Authorization', `Bearer ${token}`)
        .send(notice3)
        .expect(200);

      const state3 = await prisma.shiftSyncState.findUnique({ where: { shiftId: shift.id } });
      expect(state3?.lastPendingCount).toBe(1);
      // Ahora sí avanzó
      expect(state3?.syncedUntil).toEqual(new Date(timeNewer));
    });
  });

  describe('Rendimiento — 500 eventos en lotes de 100 tardan menos de 30 s', () => {
    it('procesa 500 eventos distribuidos en 5 lotes de 100 en menos de 30 segundos', async () => {
      const client = request(app.getHttpServer());
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

      const qrPayload = qrService.createPayload(testCheckpointId, 1);
      const totalEvents = 500;
      const batchSize = 100;
      const batchesCount = totalEvents / batchSize;
      const recordTime = new Date(shift.startsAt.getTime() + 10 * 60 * 1000).toISOString();

      const startTime = performance.now();

      for (let b = 0; b < batchesCount; b++) {
        const events = [];
        for (let i = 0; i < batchSize; i++) {
          const eventId = randomUUID();
          events.push({
            type: 'checkpoint_record' as const,
            payload: {
              recordId: eventId,
              shiftId: shift.id,
              method: 'qr' as const,
              scannedValue: qrPayload,
              occurredAtDevice: recordTime,
              location: { ...defaultLocation, takenAt: recordTime },
              phoneNfc: 'on' as const,
            },
          });
        }

        const batchReq = {
          shiftId: shift.id,
          pendingCount: totalEvents - (b + 1) * batchSize,
          syncedUntil: recordTime,
          events,
        };

        const res = await client
          .post('/api/v1/sincronizacion/eventos')
          .set('Authorization', `Bearer ${token}`)
          .send(batchReq)
          .expect(200);

        const resBody = res.body as { results: unknown[] };
        expect(resBody.results).toHaveLength(batchSize);
      }

      const durationMs = performance.now() - startTime;
      // Exigencia del requerimiento: < 30 s (30000 ms)
      process.stdout.write(`500 eventos procesados en ${durationMs.toFixed(2)} ms\n`);
      expect(durationMs).toBeLessThan(30000);
    }, 35000);
  });
});
