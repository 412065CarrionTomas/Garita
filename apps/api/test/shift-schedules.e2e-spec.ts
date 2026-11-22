import { Test } from '@nestjs/testing';
import { Logger, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  scheduleOperationSchema,
  schedulePreviewSchema,
  type ShiftScheduleInput,
} from '@garita/shared';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { ShiftsService } from '../src/modules/shifts/shifts.service';
import { FIREBASE_IDENTITY_PROVIDER } from '../src/modules/auth/auth.types';
import { CLOCK } from '../src/common/clock';
import { NOTIFICATIONS_PORT } from '../src/common/ports/notifications.port';
import { REALTIME_PORT } from '../src/common/ports/realtime.port';
import { MercadoPagoClient } from '../src/modules/subscriptions/mercadopago.client';

describe('HU-32 programaciones semanales por HTTP', () => {
  let app: INestApplication<App>, db: PrismaService['systemPrisma'];
  const prefix = `hu32-${randomUUID()}`,
    companyId = `${prefix}-company`,
    foreignCompanyId = `${prefix}-foreign`;
  let now = new Date('2026-10-01T12:00:00Z');
  let siteId: string,
    hiddenSiteId: string,
    clientId: string,
    roundId: string,
    guardId: string,
    targetId: string,
    adminId: string;
  let input: ShiftScheduleInput;
  const notifyUsers = jest.fn().mockResolvedValue(undefined);
  const http = () => request(app.getHttpServer());
  const auth = (role = 'admin') => ({ Authorization: `Bearer ${prefix}-${role}` });
  const post = (path: string, body: object, role = 'admin') =>
    http().post(`/api/v1/${path}`).set(auth(role)).send(body);
  const create = async (patch: Partial<ShiftScheduleInput> = {}) =>
    scheduleOperationSchema.parse(
      (await post('programaciones-turnos', { ...input, ...patch }).expect(201)).body,
    );

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FIREBASE_IDENTITY_PROVIDER)
      .useValue({
        verifyIdToken: (uid: string) => Promise.resolve({ uid }),
        setDisabled: jest.fn(),
        revokeRefreshTokens: jest.fn(),
      })
      .overrideProvider(CLOCK)
      .useValue({ now: () => now })
      .overrideProvider(NOTIFICATIONS_PORT)
      .useValue({ notifyUsers, notifySiteStaff: jest.fn() })
      .overrideProvider(REALTIME_PORT)
      .useValue({ emitToSite: jest.fn() })
      .overrideProvider(MercadoPagoClient)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get(PrismaService).systemPrisma;
    await db.company.createMany({
      data: [companyId, foreignCompanyId].map((id) => ({ id, name: id, accountStatus: 'active' })),
    });
    clientId = (
      await db.client.create({
        data: {
          companyId,
          name: prefix,
          contactName: 'Prueba',
          email: `${prefix}@example.invalid`,
          phone: '+541112345678',
        },
      })
    ).id;
    let supervisorId = '';
    for (const role of ['admin', 'supervisor', 'guard', 'client', 'target', 'foreign'] as const) {
      const user = await db.user.create({
        data: {
          companyId: role === 'foreign' ? foreignCompanyId : companyId,
          firebaseUid: `${prefix}-${role}`,
          email: `${prefix}-${role}@example.invalid`,
          firstName: 'Prueba',
          lastName: role,
          role: role === 'target' ? 'guard' : role === 'foreign' ? 'admin' : role,
          status: 'active',
          ...(role === 'client' ? { clientId } : {}),
        },
      });
      if (role === 'admin') adminId = user.id;
      if (role === 'supervisor') supervisorId = user.id;
      if (role === 'guard') guardId = user.id;
      if (role === 'target') targetId = user.id;
    }
    for (const hidden of [false, true]) {
      const site = await db.site.create({
        data: {
          companyId,
          clientId,
          name: hidden ? 'Oculto' : 'Depósito Ruta 9',
          address: 'Ruta 9',
          latitude: -34,
          longitude: -58,
        },
      });
      if (hidden) hiddenSiteId = site.id;
      else {
        siteId = site.id;
        await db.siteSupervisor.create({ data: { companyId, siteId, userId: supervisorId } });
      }
    }
    const round = await db.round.create({ data: { companyId, siteId, name: 'Semanal' } });
    roundId = round.id;
    const version = await db.roundVersion.create({
      data: {
        roundId,
        versionNumber: 1,
        frequencyMinutes: 180,
        windowStartLocal: '22:00',
        windowEndLocal: '08:00',
        graceMinutes: 15,
        createdById: adminId,
      },
    });
    await db.round.update({ where: { id: roundId }, data: { currentVersionId: version.id } });
    input = {
      siteId,
      guardId,
      roundIds: [roundId],
      weekdays: [1, 2, 3, 4, 5],
      startTime: '22:00',
      endTime: '06:00',
      startDate: '2026-10-05',
      endDate: '2026-10-30',
    };
  });
  beforeEach(async () => {
    now = new Date('2026-10-01T12:00:00Z');
    await db.shift.deleteMany({ where: { companyId } });
    await db.shiftSchedule.deleteMany({ where: { companyId } });
    await db.user.updateMany({ where: { companyId }, data: { status: 'active' } });
    await db.client.update({ where: { id: clientId }, data: { status: 'active' } });
    await db.site.updateMany({ where: { companyId }, data: { status: 'active' } });
    notifyUsers.mockClear();
  });
  afterAll(async () => {
    await db.shift.deleteMany({ where: { companyId } });
    await db.shiftSchedule.deleteMany({ where: { companyId } });
    await db.round.update({ where: { id: roundId }, data: { currentVersionId: null } });
    await db.roundVersion.deleteMany({ where: { roundId } });
    await db.round.delete({ where: { id: roundId } });
    await db.siteSupervisor.deleteMany({ where: { companyId } });
    await db.site.deleteMany({ where: { companyId } });
    await db.user.deleteMany({ where: { companyId: { in: [companyId, foreignCompanyId] } } });
    await db.client.delete({ where: { id: clientId } });
    await db.company.deleteMany({ where: { id: { in: [companyId, foreignCompanyId] } } });
    await app.close();
  });

  it('CA1 y CA6: genera 20, informa ventanas sin cubrir y envía un solo resumen', async () => {
    const preview = schedulePreviewSchema.parse(
      (await post('programaciones-turnos/previsualizar', input, 'supervisor').expect(201)).body,
    );
    expect(preview.shifts).toHaveLength(20);
    expect(preview.uncoveredWindows.length).toBeGreaterThan(0);
    expect(await db.shiftSchedule.count({ where: { companyId } })).toBe(0);
    const created = await create();
    expect(created.generated).toHaveLength(20);
    const shifts = await db.shift.findMany({
      where: { scheduleId: created.schedule.id },
      orderBy: { startsAt: 'asc' },
    });
    expect(shifts[0]?.serviceDate.toISOString().slice(0, 10)).toBe('2026-10-05');
    expect(shifts.at(-1)?.serviceDate.toISOString().slice(0, 10)).toBe('2026-10-30');
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    expect(notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'shift_schedule_summary', userIds: [guardId] }),
    );
  });
  it('CA2: identifica el miércoles 14 superpuesto y genera los otros 19', async () => {
    const overlap = await db.shift.create({
      data: {
        companyId,
        siteId,
        createdById: adminId,
        serviceDate: new Date('2026-10-14'),
        startsAt: new Date('2026-10-14T23:00Z'),
        endsAt: new Date('2026-10-15T11:00Z'),
        assignments: {
          create: {
            guardId,
            assignedById: adminId,
            startsAt: new Date('2026-10-14T23:00Z'),
            endsAt: new Date('2026-10-15T11:00Z'),
          },
        },
      },
    });
    const preview = schedulePreviewSchema.parse(
      (await post('programaciones-turnos/previsualizar', input).expect(201)).body,
    );
    expect(preview.shifts.filter((shift) => shift.conflicts.length)).toEqual([
      expect.objectContaining({
        serviceDate: '2026-10-14',
        conflicts: [expect.objectContaining({ shiftId: overlap.id })],
      }),
    ]);
    expect((await create()).generated).toHaveLength(19);
  });
  it.each([
    { weekdays: [] },
    { startDate: '2026-10-01', endDate: '2027-01-01' },
    { startDate: '2026-09-30' },
    { endDate: 'invalid' },
  ])('CA5 rechaza %j', async (patch) => {
    await post('programaciones-turnos', { ...input, ...patch }).expect(400);
    expect(await db.shiftSchedule.count({ where: { companyId } })).toBe(0);
  });
  it('aplica las validaciones individuales: invitación pendiente permitida; predio, rondas y horas inválidas rechazados', async () => {
    await db.user.update({ where: { id: guardId }, data: { status: 'invitation_pending' } });
    expect((await create()).generated).toHaveLength(20);
    await db.user.update({ where: { id: guardId }, data: { status: 'deactivated' } });
    await post('programaciones-turnos/previsualizar', input).expect(404);
    await db.user.update({ where: { id: guardId }, data: { status: 'active' } });
    await post('programaciones-turnos/previsualizar', { ...input, roundIds: ['missing'] }).expect(
      404,
    );
    await post('programaciones-turnos/previsualizar', {
      ...input,
      startTime: '10:00',
      endTime: '11:00',
    }).expect(400);
    await db.site.update({ where: { id: siteId }, data: { status: 'inactive' } });
    await post('programaciones-turnos/previsualizar', input).expect(404);
  });
  it('CA3: conserva edición, cambio de vigilador y reasignación; permite regenerar dos veces sin duplicados', async () => {
    const created = await create();
    const shifts = await db.shift.findMany({
      where: { scheduleId: created.schedule.id },
      orderBy: { startsAt: 'asc' },
    });
    const [edited, changed, reassigned] = shifts;
    if (!edited || !changed || !reassigned) throw new Error('Faltan turnos');
    for (const [shift, guard] of [
      [edited, guardId],
      [changed, targetId],
    ] as const)
      await http()
        .patch(`/api/v1/turnos/${shift.id}`)
        .set(auth())
        .send({
          siteId,
          guardId: guard,
          roundIds: [roundId],
          startsAt: shift.startsAt.toISOString(),
          endsAt: shift.endsAt.toISOString(),
        })
        .expect(200);
    await post(`turnos/${reassigned.id}/reasignar`, {
      guardId: targetId,
      startsAt: reassigned.startsAt.toISOString(),
    }).expect(201);
    for (const startTime of ['21:00', '20:00']) {
      const result = scheduleOperationSchema.parse(
        (
          await http()
            .patch(`/api/v1/programaciones-turnos/${created.schedule.id}`)
            .set(auth())
            .send({ startTime })
            .expect(200)
        ).body,
      );
      expect(result.conserved).toEqual(
        expect.arrayContaining([edited.id, changed.id, reassigned.id]),
      );
      expect(result.generated).toHaveLength(17);
      const active = await db.shift.findMany({
        where: { scheduleId: created.schedule.id, status: 'scheduled' },
      });
      expect(active).toHaveLength(20);
      expect(new Set(active.map((shift) => shift.serviceDate.toISOString())).size).toBe(20);
    }
  });
  it('revierte una falla inyectada a mitad de la regeneración y no entrega notificaciones', async () => {
    const created = await create();
    const before = await db.shift.findMany({
      where: { scheduleId: created.schedule.id },
      orderBy: { id: 'asc' },
    });
    const shifts = app.get(ShiftsService),
      original = shifts.cancelInTransaction.bind(shifts);
    let calls = 0;
    const failure = jest
      .spyOn(shifts, 'cancelInTransaction')
      .mockImplementation(async (...args) => {
        calls++;
        if (calls === 2) throw new Error('Falla inyectada HU-32');
        return original(...args);
      });
    notifyUsers.mockClear();
    try {
      await http()
        .patch(`/api/v1/programaciones-turnos/${created.schedule.id}`)
        .set(auth())
        .send({ startTime: '21:00' })
        .expect(500);
    } finally {
      failure.mockRestore();
    }
    expect(
      await db.shift.findMany({
        where: { scheduleId: created.schedule.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
    expect(
      (await db.shiftSchedule.findUniqueOrThrow({ where: { id: created.schedule.id } })).startTime,
    ).toBe('22:00');
    expect(notifyUsers).not.toHaveBeenCalled();
  });
  it('CA4 cancela 12 futuros y conserva 8 realizados', async () => {
    const created = await create();
    const shifts = await db.shift.findMany({
      where: { scheduleId: created.schedule.id },
      orderBy: { startsAt: 'asc' },
    });
    const done = shifts.slice(0, 8).map((shift) => shift.id);
    await db.shift.updateMany({ where: { id: { in: done } }, data: { status: 'closed' } });
    await db.shiftAssignment.updateMany({
      where: { shiftId: { in: done } },
      data: { active: false },
    });
    now = new Date('2026-10-15T15:00Z');
    const result = scheduleOperationSchema.parse(
      (await post(`programaciones-turnos/${created.schedule.id}/cancelar`, {}).expect(201)).body,
    );
    expect(result.replaced).toHaveLength(12);
    expect(result.conserved.sort()).toEqual(done.sort());
    expect(
      await db.shift.count({ where: { scheduleId: created.schedule.id, status: 'closed' } }),
    ).toBe(8);
  });
  it('conserva turnos iniciados antes de hora y estados no editables', async () => {
    const created = await create();
    const first = created.generated[0];
    await db.shift.update({
      where: { id: first },
      data: { status: 'in_progress', startedAt: now },
    });
    const result = scheduleOperationSchema.parse(
      (
        await http()
          .patch(`/api/v1/programaciones-turnos/${created.schedule.id}`)
          .set(auth())
          .send({ startTime: '21:00' })
          .expect(200)
      ).body,
    );
    expect(result.conserved).toContain(first);
    expect((await db.shift.findUniqueOrThrow({ where: { id: first } })).status).toBe('in_progress');
  });
  it('extiende solo la continuación y rechaza repetir o exceder tres meses adicionales', async () => {
    const created = await create();
    const extension = scheduleOperationSchema.parse(
      (
        await post(`programaciones-turnos/${created.schedule.id}/extender`, {
          endDate: '2026-11-06',
        }).expect(201)
      ).body,
    );
    expect(extension.generated).toHaveLength(5);
    expect(await db.shift.count({ where: { scheduleId: created.schedule.id } })).toBe(25);
    await post(`programaciones-turnos/${created.schedule.id}/extender`, {
      endDate: '2026-11-06',
    }).expect(400);
    await post(`programaciones-turnos/${created.schedule.id}/extender`, {
      endDate: '2027-03-01',
    }).expect(400);
  });
  it('ID-121 deriva como unidad, informa superpuestos y marca los derivados individualmente', async () => {
    const created = await create();
    const first = await db.shift.findUniqueOrThrow({ where: { id: created.generated[0] } });
    await db.shift.create({
      data: {
        companyId,
        siteId,
        createdById: adminId,
        serviceDate: first.serviceDate,
        startsAt: first.startsAt,
        endsAt: first.endsAt,
        assignments: {
          create: {
            guardId: targetId,
            assignedById: adminId,
            startsAt: first.startsAt,
            endsAt: first.endsAt,
          },
        },
      },
    });
    const response = await post(`usuarios/${guardId}/desactivar`, {
      deriveToUserId: targetId,
    }).expect(201);
    expect(response.body).toMatchObject({
      derivedCount: 19,
      notDerived: [expect.objectContaining({ id: first.id })],
    });
    expect(
      await db.shift.count({
        where: { scheduleId: created.schedule.id, individuallyModified: true },
      }),
    ).toBe(19);
    expect(
      (await db.shiftSchedule.findUniqueOrThrow({ where: { id: created.schedule.id } })).guardId,
    ).toBe(targetId);
  });
  it('modifica las horas de un período previamente extendido más allá de tres meses acumulados', async () => {
    const created = await create();
    await post(`programaciones-turnos/${created.schedule.id}/extender`, {
      endDate: '2027-01-30',
    }).expect(201);
    const before = await db.shift.count({
      where: { scheduleId: created.schedule.id, status: 'scheduled' },
    });
    const response = await http()
      .patch(`/api/v1/programaciones-turnos/${created.schedule.id}`)
      .set(auth())
      .send({ startTime: '21:00' })
      .expect(200);
    expect(scheduleOperationSchema.parse(response.body).generated).toHaveLength(before);
    expect(
      await db.shift.count({ where: { scheduleId: created.schedule.id, status: 'scheduled' } }),
    ).toBe(before);
  });
  it('ID-121 termina la programación sin derivación y deja sus 20 turnos sin vigilador', async () => {
    const created = await create();
    await post(`usuarios/${guardId}/desactivar`, {
      leaveUnassigned: true,
      confirmUnassignedCount: 20,
    }).expect(201);
    expect(
      (await db.shiftSchedule.findUniqueOrThrow({ where: { id: created.schedule.id } })).status,
    ).toBe('finished');
    expect(
      await db.shift.count({ where: { scheduleId: created.schedule.id, status: 'unassigned' } }),
    ).toBe(20);
  });
  it.each(['predio', 'cliente'])(
    'ID-121: la baja de %s termina la programación y cancela sus turnos',
    async (kind) => {
      const created = await create();
      await post(kind === 'predio' ? `predios/${siteId}/baja` : `clientes/${clientId}/baja`, {
        confirm: true,
      }).expect(201);
      expect(
        (await db.shiftSchedule.findUniqueOrThrow({ where: { id: created.schedule.id } })).status,
      ).toBe('finished');
      expect(
        await db.shift.count({ where: { scheduleId: created.schedule.id, status: 'cancelled' } }),
      ).toBe(20);
    },
  );
  it('previsualiza y genera unos 90 turnos en menos de 3 segundos por operación', async () => {
    const payload = {
      ...input,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startDate: '2026-10-01',
      endDate: '2026-12-29',
    };
    const start = performance.now();
    await post('programaciones-turnos/previsualizar', payload).expect(201);
    const previewMs = performance.now() - start;
    const createStart = performance.now();
    const created = await create(payload);
    const createMs = performance.now() - createStart;
    Logger.log({
      metric: 'HU-32.performance',
      previewMs,
      createMs,
      shifts: created.generated.length,
    });
    expect(created.generated).toHaveLength(90);
    expect(previewMs).toBeLessThan(3000);
    expect(createMs).toBeLessThan(3000);
  });
  it('permisos y aislamiento de todos los endpoints; administrador ve los predios de su empresa', async () => {
    const created = await create();
    for (const [method, suffix, body] of [
      ['get', '', {}],
      ['post', '/previsualizar', input],
      ['post', '', input],
      ['patch', `/${created.schedule.id}`, { startTime: '21:00' }],
      ['post', `/${created.schedule.id}/extender`, { endDate: '2026-11-06' }],
      ['post', `/${created.schedule.id}/cancelar`, {}],
    ] as const) {
      const path = `/api/v1/programaciones-turnos${suffix}`;
      await http()[method](path).send(body).expect(401);
      for (const role of ['guard', 'client'])
        await http()[method](path).set(auth(role)).send(body).expect(403);
      if (suffix.startsWith(`/${created.schedule.id}`)) {
        await http()[method](path).set(auth('foreign')).send(body).expect(404);
      }
    }
    await post(
      'programaciones-turnos/previsualizar',
      { ...input, siteId: hiddenSiteId },
      'supervisor',
    ).expect(404);
    await post('programaciones-turnos', { ...input, siteId: hiddenSiteId }, 'supervisor').expect(
      404,
    );
    expect(
      (await http().get('/api/v1/programaciones-turnos').set(auth('foreign')).expect(200)).body,
    ).toEqual([]);
    await http().get('/api/v1/programaciones-turnos').set(auth('supervisor')).expect(200);
    await http()
      .get(`/api/v1/programaciones-turnos?predio=${hiddenSiteId}`)
      .set(auth('supervisor'))
      .expect(404);
    await http()
      .get(`/api/v1/programaciones-turnos?predio=${hiddenSiteId}`)
      .set(auth())
      .expect(200);
    for (const path of ['programaciones-turnos', 'programaciones-turnos/previsualizar'])
      await post(path, input, 'foreign').expect(404);
    await db.shiftSchedule.update({
      where: { id: created.schedule.id },
      data: { siteId: hiddenSiteId },
    });
    for (const [method, suffix, body] of [
      ['patch', '', { startTime: '21:00' }],
      ['post', '/extender', { endDate: '2026-11-06' }],
      ['post', '/cancelar', {}],
    ] as const)
      await http()
        [method](`/api/v1/programaciones-turnos/${created.schedule.id}${suffix}`)
        .set(auth('supervisor'))
        .send(body)
        .expect(404);
  });
});
