import {
  buildShiftNotification,
  notificationPayloadSchema,
  registerDeviceRequestSchema,
} from './notifications';

describe('payload de notificación', () => {
  it('acepta el contenido mínimo', () => {
    expect(
      notificationPayloadSchema.parse({
        kind: 'incident_new',
        siteName: 'Predio Norte',
        link: '/incidentes/1',
      }),
    ).toEqual({ kind: 'incident_new', siteName: 'Predio Norte', link: '/incidentes/1' });
  });

  it('rechaza campos extra como nombres o direcciones', () => {
    expect(
      notificationPayloadSchema.safeParse({
        kind: 'shift_assigned',
        link: '/turnos',
        guardName: 'Ana',
      }).success,
    ).toBe(false);
  });
});

describe('registro de dispositivo', () => {
  it('rechaza token vacío y tipo desconocido', () => {
    expect(
      registerDeviceRequestSchema.safeParse({ token: '', kind: 'web', platform: 'web' }).success,
    ).toBe(false);
    expect(
      registerDeviceRequestSchema.safeParse({ token: 't', kind: 'sms', platform: 'web' }).success,
    ).toBe(false);
  });
});

const startsAt = new Date('2030-10-05T21:00:00.000Z');
const timezone = 'UTC';

describe('buildShiftNotification', () => {
  it('keeps site and guard details out of every shift payload', () => {
    for (const kind of [
      'shift_assigned',
      'shift_changed',
      'shift_reassigned_to_you',
      'shift_reassigned_from_you',
      'shift_removed',
      'shift_cancelled',
      'shift_closed_site_removed',
    ] as const) {
      const notification = buildShiftNotification({ kind, shiftId: 'shift-1', startsAt, timezone });
      expect(notificationPayloadSchema.parse(notification.payload)).toEqual(notification.payload);
      expect(JSON.stringify(notification)).not.toMatch(/Predio A|Calle 123|Pedro/);
      expect(notification.body).toContain('21:00');
    }
  });

  it('marks an imminent reassignment high priority', () => {
    const notification = buildShiftNotification({
      kind: 'shift_reassigned_to_you',
      shiftId: 'shift-1',
      startsAt,
      timezone,
      now: new Date('2030-10-05T20:20:00.000Z'),
    });
    expect(notification.priority).toBe('high');
    expect(notification.body).toContain('Te asignaron un turno');
  });

  it('summarizes twenty programmed shifts in one message', () => {
    const notification = buildShiftNotification({
      kind: 'shift_schedule_summary',
      count: 20,
      from: startsAt,
      to: new Date('2030-10-30T21:00:00.000Z'),
      timezone,
    });
    expect(notification.body).toBe('Te programaron 20 turnos del 5 al 30 de octubre');
    expect(notification.payload.link).toBe('/mis-turnos');
  });
});
