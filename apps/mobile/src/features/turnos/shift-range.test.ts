import type { GuardShift } from '@garita/shared';
import { isoDay, monthRange, shiftStamp, splitByToday, totals, touches } from './shift-range';

const shift = (over: Partial<GuardShift>): GuardShift => ({
  id: 'id',
  status: 'scheduled',
  serviceDate: '2026-11-26',
  startsAt: '2026-11-27T01:00:00.000Z',
  endsAt: '2026-11-27T09:00:00.000Z',
  startedAt: null,
  closedAt: null,
  site: { id: 's', name: 'Predio', timezone: 'America/Argentina/Cordoba' },
  rounds: [],
  summary: null,
  ...over,
});
const summary = { windows: 4, windowsDone: 4, recorded: 16, expected: 16, incidents: 0 };

it('arma el mes completo, también al cruzar de año', () => {
  expect(monthRange(new Date(2026, 10, 26))).toEqual({ desde: '2026-11-01', hasta: '2026-11-30' });
  expect(monthRange(new Date(2026, 11, 5), 1)).toEqual({
    desde: '2027-01-01',
    hasta: '2027-01-31',
  });
  expect(isoDay(new Date(2028, 1, 29))).toBe('2028-02-29');
});

it('suma horas reales de lo trabajado y programadas de lo que viene', () => {
  const result = totals([
    shift({
      status: 'closed',
      startedAt: '2026-11-20T01:00:00Z',
      closedAt: '2026-11-20T09:30:00Z',
    }),
    shift({ status: 'scheduled' }),
    shift({ status: 'cancelled' }),
  ]);
  expect(result).toEqual({ count: 3, worked: 9, planned: 8 });
});

it('el sello dice si el turno cerrado se cumplió completo', () => {
  expect(shiftStamp(shift({ status: 'closed', summary })).label).toBe('Completo');
  expect(
    shiftStamp(shift({ status: 'auto_closed', summary: { ...summary, windowsDone: 3 } })),
  ).toEqual({
    label: 'Incompleto',
    tone: 'warning',
  });
  expect(shiftStamp(shift({ status: 'no_show' })).label).toBe('Ausente');
});

it('el nocturno cuenta en el día que empieza y en el que termina', () => {
  const night = shift({
    serviceDate: '2026-11-26',
    startsAt: new Date(2026, 10, 26, 22).toISOString(),
    endsAt: new Date(2026, 10, 27, 6).toISOString(),
  });
  const untilMidnight = shift({
    serviceDate: '2026-11-26',
    startsAt: new Date(2026, 10, 26, 16).toISOString(),
    endsAt: new Date(2026, 10, 27, 0).toISOString(),
  });
  expect(touches(night, { desde: '2026-11-26', hasta: '2026-11-26' })).toBe(true);
  expect(touches(night, { desde: '2026-11-27', hasta: '2026-11-27' })).toBe(true);
  expect(touches(night, { desde: '2026-11-28', hasta: '2026-11-30' })).toBe(false);
  expect(touches(untilMidnight, { desde: '2026-11-27', hasta: '2026-11-27' })).toBe(false);
});

it('separa por si ya terminó: el nocturno de anoche sigue entre los próximos hasta su fin', () => {
  const now = new Date(2026, 10, 27, 3);
  const at = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString();
  const list = [
    shift({ id: 'a', status: 'closed', startsAt: at(24, 22), endsAt: at(25, 6) }),
    shift({ id: 'b', status: 'closed', startsAt: at(25, 22), endsAt: at(26, 6) }),
    shift({ id: 'c', startsAt: at(26, 22), endsAt: at(27, 6) }),
    shift({ id: 'd', startsAt: at(27, 22), endsAt: at(28, 6) }),
  ];
  const { upcoming, past } = splitByToday(list, now);
  expect(upcoming.map((s) => s.id)).toEqual(['c', 'd']);
  expect(past.map((s) => s.id)).toEqual(['b', 'a']);
});
