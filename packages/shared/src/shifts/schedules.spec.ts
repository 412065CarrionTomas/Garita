import { generateScheduledShifts, shiftScheduleInputSchema } from './schedules';
import { buildShiftNotification } from '../notifications';

it('el resumen de una programación distingue los meses y años del período', () => {
  const notification = buildShiftNotification({
    kind: 'shift_schedule_summary',
    count: 90,
    from: new Date('2026-11-01T22:00Z'),
    to: new Date('2027-01-29T22:00Z'),
    timezone: 'America/Argentina/Buenos_Aires',
  });
  expect(notification.body).toBe(
    'Te programaron 90 turnos del 1 de noviembre de 2026 al 29 de enero de 2027',
  );
});

const input = {
  siteId: 'site',
  guardId: 'guard',
  roundIds: ['round'],
  weekdays: [1, 2, 3, 4, 5],
  startTime: '22:00',
  endTime: '06:00',
  startDate: '2026-10-05',
  endDate: '2026-10-30',
};
const timezone = 'America/Argentina/Buenos_Aires';

it('CA1: genera exactamente 20 turnos en el día de inicio, con fin incluido', () => {
  const shifts = generateScheduledShifts(input, timezone);
  expect(shifts).toHaveLength(20);
  expect(shifts[0]).toEqual({
    serviceDate: '2026-10-05',
    startsAt: '2026-10-06T01:00:00.000Z',
    endsAt: '2026-10-06T09:00:00.000Z',
  });
  expect(shifts.at(-1)?.serviceDate).toBe('2026-10-30');
});
it('recorta semanas parciales y admite un solo día y medianoche', () => {
  expect(
    generateScheduledShifts({ ...input, startDate: '2026-10-07', endDate: '2026-10-13' }, timezone),
  ).toHaveLength(5);
  expect(
    generateScheduledShifts(
      {
        ...input,
        startDate: '2026-10-05',
        endDate: '2026-10-05',
        startTime: '00:00',
        endTime: '08:00',
      },
      timezone,
    )[0],
  ).toMatchObject({ startsAt: '2026-10-05T03:00:00.000Z', endsAt: '2026-10-05T11:00:00.000Z' });
});
it.each([
  { weekdays: [] },
  { weekdays: [1, 1] },
  { weekdays: [7] },
  { startDate: '2026-01-01', endDate: '2026-04-01' },
  { startTime: '25:00' },
])('rechaza una programación inválida %j', (invalid) => {
  expect(shiftScheduleInputSchema.safeParse({ ...input, ...invalid }).success).toBe(false);
});
it('limita tres meses de calendario con el extremo final excluido del cómputo', () => {
  expect(
    shiftScheduleInputSchema.safeParse({ ...input, startDate: '2026-01-01', endDate: '2026-03-31' })
      .success,
  ).toBe(true);
});
it('usa la zona de la empresa a ambos lados del cambio de horario de verano', () => {
  const shifts = generateScheduledShifts(
    {
      ...input,
      weekdays: [0],
      startDate: '2026-03-01',
      endDate: '2026-03-15',
      startTime: '00:00',
      endTime: '08:00',
    },
    'America/New_York',
  );
  expect(shifts.map(({ startsAt, endsAt }) => [startsAt, endsAt])).toEqual([
    ['2026-03-01T05:00:00.000Z', '2026-03-01T13:00:00.000Z'],
    ['2026-03-08T05:00:00.000Z', '2026-03-08T12:00:00.000Z'],
    ['2026-03-15T04:00:00.000Z', '2026-03-15T12:00:00.000Z'],
  ]);
});
it('rechaza una hora local inexistente en lugar de desplazar el turno', () => {
  expect(() =>
    generateScheduledShifts(
      {
        ...input,
        weekdays: [0],
        startDate: '2026-03-08',
        endDate: '2026-03-08',
        startTime: '02:30',
      },
      'America/New_York',
    ),
  ).toThrow('no existe');
});
