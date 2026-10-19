import { notificationPayloadSchema, registerDeviceRequestSchema } from './notifications';

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
