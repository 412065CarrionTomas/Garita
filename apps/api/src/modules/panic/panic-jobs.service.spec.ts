import type { Queue } from 'bullmq';
import type { PrismaService } from '../prisma/prisma.service';
import { PanicJobsService } from './panic-jobs.service';
import { buildStaffPanicSms } from './panic-sms-message';
import { PanicEscalationProcessor, PanicSmsProcessor } from './panic.processors';
import type { Job } from 'bullmq';
import { NoopSms } from '../../common/ports/sms.port';

const input = { companyId: 'company', alertId: '019cbfe6-bdb0-7000-8000-123456789012' };

function fixture() {
  const alert = {
    id: input.alertId,
    companyId: 'company',
    siteId: 'site',
    status: 'active',
    receivedAt: new Date(),
    triggeredAt: new Date('2026-10-13T06:10:00Z'),
    escalatedAt: null as Date | null,
    site: { name: 'Depósito Ruta 9' },
    company: { timezone: 'America/Argentina/Buenos_Aires' },
  };
  const events = new Map<string, { data: { delivered: boolean } }>();
  const deliveries = new Map<string, { status: string }>();
  const tx = {
    panicAlert: {
      findFirst: jest.fn(() => Promise.resolve(alert)),
      updateMany: jest.fn(() => {
        if (alert.status !== 'active' || alert.escalatedAt) return Promise.resolve({ count: 0 });
        alert.escalatedAt = new Date();
        return Promise.resolve({ count: 1 });
      }),
    },
    panicAlertEvent: {
      create: jest.fn(({ data }: { data: { id?: string; data?: { delivered: boolean } } }) => {
        if (data.id && data.data) events.set(data.id, { data: data.data });
        return Promise.resolve();
      }),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(events.get(where.id)),
      ),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: { data: { delivered: boolean } } }) => {
          events.set(where.id, data);
          return Promise.resolve();
        },
      ),
    },
    user: {
      findMany: jest.fn(() => Promise.resolve([{ id: 'supervisor', phone: '+5493511234567' }])),
    },
    panicSmsDelivery: {
      findUnique: jest.fn(({ where }: { where: { alertId_userId_reason: { userId: string } } }) =>
        Promise.resolve(deliveries.get(where.alertId_userId_reason.userId)),
      ),
      upsert: jest.fn(({ create }: { create: { userId: string; status: string } }) => {
        deliveries.set(create.userId, { status: create.status });
        return Promise.resolve();
      }),
    },
  };
  const prisma = {
    systemPrisma: {
      ...tx,
      $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    },
  };
  const notifications = {
    notifySiteStaff: jest.fn(() => Promise.resolve()),
    notifyUsers: jest.fn(() => Promise.resolve()),
  };
  const realtime = { emitToSite: jest.fn() };
  const sms = {
    sendPanicAlert: jest.fn<
      Promise<{ sent: boolean }>,
      [{ phone: string; companyId: string; alertId: string; message: string }]
    >(() => Promise.resolve({ sent: true })),
    sendShiftClosed: jest.fn(() => Promise.resolve()),
  };
  const smsQueue = { add: jest.fn(() => Promise.resolve()) };
  const escalationQueue = { add: jest.fn(() => Promise.resolve()) };
  const jobs = new PanicJobsService(
    prisma as unknown as PrismaService,
    { now: () => new Date() },
    notifications,
    realtime,
    sms,
    smsQueue as unknown as Queue,
    escalationQueue as unknown as Queue,
  );
  return {
    jobs,
    alert,
    events,
    deliveries,
    tx,
    notifications,
    realtime,
    sms,
    smsQueue,
    escalationQueue,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-13T06:25:00Z'));
});
afterEach(() => {
  jest.useRealTimers();
});

it('encola SMS inicial y escalamiento a los 120 segundos con claves estables', async () => {
  const f = fixture();
  await f.jobs.schedule(input, f.alert.receivedAt);
  expect(f.escalationQueue.add).toHaveBeenCalledWith('escalate', input, {
    jobId: input.alertId,
    delay: 120000,
  });
  expect(f.smsQueue.add).toHaveBeenCalledWith(
    'send',
    { ...input, reason: 'initial' },
    { jobId: `${input.alertId}-initial` },
  );
});

it('HU-43 conserva SMS, push y escalamiento con la empresa suspendida', async () => {
  const f = fixture();
  Object.assign(f.alert.company, { accountStatus: 'suspended' });
  await f.jobs.schedule(input, f.alert.receivedAt);
  jest.advanceTimersByTime(120000);
  await f.jobs.escalate(input);
  expect(f.smsQueue.add).toHaveBeenCalled();
  expect(f.notifications.notifySiteStaff).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'panic', priority: 'high' }),
  );
});

it('a los 120 segundos escala una sola vez, reenvía push alta y encola SMS de escalamiento', async () => {
  const f = fixture();
  jest.advanceTimersByTime(119000);
  await f.jobs.escalate(input);
  expect(f.notifications.notifySiteStaff).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1000);
  await f.jobs.escalate(input);
  await f.jobs.escalate(input);
  expect(f.alert.escalatedAt).toEqual(new Date());
  expect(f.events.size).toBe(1);
  expect(f.notifications.notifySiteStaff).toHaveBeenCalledTimes(1);
  expect(f.notifications.notifySiteStaff).toHaveBeenCalledWith(
    expect.objectContaining({ priority: 'high', kind: 'panic' }),
  );
  expect(f.smsQueue.add).toHaveBeenCalledWith(
    'send',
    { ...input, reason: 'escalation' },
    { jobId: `${input.alertId}-escalation` },
  );
  expect(f.realtime.emitToSite).toHaveBeenCalledWith('company', 'site', 'panico.actualizado', {
    alertId: input.alertId,
    siteId: 'site',
  });
});

it('confirmada antes del plazo no produce escalamiento', async () => {
  const f = fixture();
  f.alert.status = 'confirmed';
  jest.advanceTimersByTime(120000);
  await f.jobs.escalate(input);
  expect(f.alert.escalatedAt).toBeNull();
  expect(f.notifications.notifySiteStaff).not.toHaveBeenCalled();
  expect(f.smsQueue.add).not.toHaveBeenCalled();
});

it('reintenta un fallo de cola después de persistir el escalamiento sin duplicar el evento', async () => {
  const f = fixture();
  jest.advanceTimersByTime(120000);
  f.smsQueue.add.mockRejectedValueOnce(new Error('Redis no disponible'));
  await expect(f.jobs.escalate(input)).rejects.toThrow('Redis');
  await f.jobs.escalate(input);
  expect(f.events.size).toBe(1);
  expect(f.notifications.notifySiteStaff).toHaveBeenCalledTimes(1);
});

it('formatea un SMS corto sin tildes, identidad ni coordenadas y con hora local', () => {
  expect(
    buildStaffPanicSms(
      'Depósito Ruta 9',
      new Date('2026-10-13T06:10:00Z'),
      'America/Argentina/Buenos_Aires',
    ),
  ).toBe('Garita: alerta de panico en Deposito Ruta 9, 03:10. Abri el panel.');
  const long = buildStaffPanicSms('Á'.repeat(200), new Date(), 'UTC');
  expect(long.length).toBeLessThanOrEqual(160);
  expect(long).toMatch(/^[\x20-\x7e]+$/);
});

it('en escalamiento incluye supervisores y administradores, omite teléfonos inválidos y no reenvía aceptados', async () => {
  const f = fixture();
  f.tx.user.findMany
    .mockResolvedValueOnce([
      { id: 'supervisor', phone: '+5493511234567' },
      { id: 'invalid', phone: 'abc' },
    ])
    .mockResolvedValueOnce([{ id: 'admin', phone: '+5493517654321' }]);
  await f.jobs.sendSms({ ...input, reason: 'escalation' });
  expect(f.sms.sendPanicAlert).toHaveBeenCalledTimes(2);
  expect(f.deliveries.get('invalid')?.status).toBe('skipped');
  expect(f.deliveries.get('admin')?.status).toBe('accepted');
  expect(f.sms.sendPanicAlert.mock.calls.map((call) => call[0])).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        phone: '+5493517654321',
        message: 'Garita: alerta de panico en Deposito Ruta 9, 03:10. Abri el panel.',
      }),
    ]),
  );
  await f.jobs.sendSms({ ...input, reason: 'escalation' });
  expect(f.sms.sendPanicAlert).toHaveBeenCalledTimes(2);
});

it('sin teléfono válido recurre al administrador y reintenta un rechazo del proveedor', async () => {
  const f = fixture();
  f.tx.user.findMany
    .mockResolvedValueOnce([{ id: 'supervisor', phone: '' }])
    .mockResolvedValueOnce([{ id: 'admin', phone: '+5493517654321' }]);
  f.sms.sendPanicAlert.mockResolvedValue({ sent: false });
  await expect(f.jobs.sendSms({ ...input, reason: 'initial' })).rejects.toThrow('SMS');
  expect(f.sms.sendPanicAlert).toHaveBeenCalledTimes(1);
  expect(f.deliveries.get('supervisor')?.status).toBe('skipped');
  expect(f.deliveries.get('admin')?.status).toBe('failed');
});

it('guarda failed al lanzar el puerto y reintenta solamente los destinatarios fallidos', async () => {
  const f = fixture();
  f.sms.sendPanicAlert.mockRejectedValueOnce(new Error('Proveedor caído'));
  await expect(f.jobs.sendSms({ ...input, reason: 'initial' })).rejects.toThrow('SMS');
  expect(f.deliveries.get('supervisor')?.status).toBe('failed');
  await f.jobs.sendSms({ ...input, reason: 'initial' });
  expect(f.deliveries.get('supervisor')?.status).toBe('accepted');
});

it('el proveedor log sigue omitiendo envíos sin disparar reintentos', async () => {
  const f = fixture();
  Object.setPrototypeOf(f.sms, NoopSms.prototype);
  f.sms.sendPanicAlert.mockResolvedValue({ sent: false });
  await f.jobs.sendSms({ ...input, reason: 'initial' });
  expect(f.deliveries.get('supervisor')?.status).toBe('skipped');
});

it('los procesadores rechazan payloads de cola inválidos', async () => {
  const f = fixture();
  await expect(
    new PanicSmsProcessor(f.jobs).process({ data: { alertId: 'inválido' } } as Job<unknown>),
  ).rejects.toThrow();
  await expect(
    new PanicEscalationProcessor(f.jobs).process({ data: {} } as Job<unknown>),
  ).rejects.toThrow();
});
