import type { GuardShift } from '@garita/shared';
import { isoDay, monthRange, shiftStamp, splitByToday, totals } from './shift-range';

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

it('separa próximos de anteriores con el más reciente primero', () => {
  const list = [
    shift({ id: 'a', serviceDate: '2026-11-20', status: 'closed' }),
    shift({ id: 'b', serviceDate: '2026-11-24', status: 'closed' }),
    shift({ id: 'c', serviceDate: '2026-11-25', status: 'in_progress' }),
    shift({ id: 'd', serviceDate: '2026-11-26' }),
  ];
  const { upcoming, past } = splitByToday(list, '2026-11-26');
  expect(upcoming.map((s) => s.id)).toEqual(['c', 'd']);
  expect(past.map((s) => s.id)).toEqual(['b', 'a']);
});
