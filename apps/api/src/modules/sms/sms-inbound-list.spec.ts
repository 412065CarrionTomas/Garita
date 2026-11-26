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
    ]);
    db.smsInbound.count.mockResolvedValue(4);
    db.shift.findMany.mockResolvedValue([
      {
        id: 'shift-1',
        site: { name: 'Predio Norte' },
        assignments: [
          {
            guardId: 'g-old',
            startsAt: at('2026-11-20T08:00:00Z'),
            endsAt: at('2026-11-20T12:00:00Z'),
            isCurrent: false,
          },
          {
            guardId: 'g-new',
            startsAt: at('2026-11-20T12:00:00Z'),
            endsAt: at('2026-11-20T20:00:00Z'),
            isCurrent: true,
          },
        ],
      },
    ]);
    db.user.findMany.mockResolvedValue([
      { id: 'g-old', firstName: 'Bruno', lastName: 'Paz' },
      { id: 'g-new', firstName: 'Ana', lastName: 'Gómez' },
    ]);
    const page = await service.list({ buscar: ' ayuda  tranquera ', pagina: 2, porPagina: 5 });
    const args = (db.smsInbound.findMany.mock.calls as unknown[][])[0]?.[0] as {
      where: { AND: unknown[] };
      skip: number;
      take: number;
    };
    expect(args.where.AND).toHaveLength(2);
    expect(args).toMatchObject({ skip: 5, take: 5 });
    expect(page.items.map((item) => item.sender)).toEqual([
      { guardName: 'Bruno Paz', siteName: 'Predio Norte' },
      null,
    ]);
    expect(page).toMatchObject({
      pageSize: 5,
      total: 4,
      resumen: { valid: 4, unverified: 4, unknown: 4 },
    });
  });
});
