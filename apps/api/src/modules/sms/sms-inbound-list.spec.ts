import { SmsInboundService } from './sms-inbound.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PanicService } from '../panic/panic.service';

const at = (iso: string) => new Date(iso);
const row = (id: string, shiftId: string | null, receivedAt: string) => ({
  id,
  provider: 'http',
  messageId: id,
  fromOriginal: '+5493515200104',
  fromNormalized: '3515200104',
  text: 'GARITA PANICO',
  receivedAt: at(receivedAt),
  gatewayReceivedAt: at(receivedAt),
  result: 'valid',
  alertId: null,
  alert: null as null | object,
  shiftId,
});

describe('SmsInboundService.list', () => {
  const db = {
    smsInbound: { findMany: jest.fn(), count: jest.fn() },
    shift: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  };
  const service = new SmsInboundService(
    { tenantPrisma: db } as unknown as PrismaService,
    {} as PanicService,
    { now: () => new Date() },
  );

  it('busca por palabra, pagina y nombra al vigilador asignado cuando llegó el SMS', async () => {
    db.smsInbound.findMany.mockResolvedValue([
      row('a', 'shift-1', '2026-11-20T10:00:00Z'),
      row('b', null, '2026-11-20T11:00:00Z'),
      {
        ...row('c', 'shift-1', '2026-11-20T13:00:00Z'),
        alertId: 'alert',
        alert: { site: { name: 'Predio Norte' }, guard: { firstName: 'Ana', lastName: 'Gómez' } },
      },
    ]);
    // Conteos por estado: valid, unverified, unknown.
    for (const n of [4, 2, 1]) db.smsInbound.count.mockResolvedValueOnce(n);
    db.shift.findMany.mockResolvedValue([
      {
        id: 'shift-1',
        site: { name: 'Predio Norte' },
        assignments: [
          // El relevo crea una asignación nueva; la anterior queda inactiva con el mismo fin.
          { guardId: 'g-old', createdAt: at('2026-11-20T08:00:00Z') },
          { guardId: 'g-new', createdAt: at('2026-11-20T12:00:00Z') },
        ],
      },
    ]);
    db.user.findMany.mockResolvedValue([
      { id: 'g-old', firstName: 'Bruno', lastName: 'Paz' },
      { id: 'g-new', firstName: 'Ana', lastName: 'Gómez' },
    ]);
    const page = await service.list({
      buscar: ' ayuda  tranquera ',
      orden: 'origen',
      sentido: 'asc',
      pagina: 2,
      porPagina: 5,
    });
    const args = (db.smsInbound.findMany.mock.calls as unknown[][])[0]?.[0] as {
      where: { AND: unknown[] };
      skip: number;
      take: number;
      orderBy: object[];
    };
    expect(args.where.AND).toHaveLength(2);
    // El turno se busca solo para el SMS sin alerta, y con todas sus asignaciones.
    const shiftArgs = (db.shift.findMany.mock.calls as unknown[][])[0]?.[0] as {
      where: unknown;
      select: { assignments: { where?: unknown } };
    };
    expect(shiftArgs.where).toEqual({ id: { in: ['shift-1'] } });
    expect(shiftArgs.select.assignments.where).toBeUndefined();
    expect(args).toMatchObject({ skip: 5, take: 5 });
    expect(args.orderBy[0]).toEqual({ fromNormalized: 'asc' });
    expect(page.items.map((item) => item.sender)).toEqual([
      { guardName: 'Bruno Paz', siteName: 'Predio Norte' },
      null,
      { guardName: 'Ana Gómez', siteName: 'Predio Norte' },
    ]);
    expect(page).toMatchObject({
      pageSize: 5,
      total: 7,
      resumen: { valid: 4, unverified: 2, unknown: 1 },
    });
  });
});
