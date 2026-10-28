import { buildPanicSms, panicShortId, parsePanicSms } from './panic';

const alertId = 'a7c2e91f-3b4d-4e5f-8a6b-7c8d9e0f1a2b';

describe('SMS de pánico', () => {
  it('arma el formato de la plataforma en un solo SMS', () => {
    const sms = buildPanicSms({
      alertId,
      shiftCode: '483920',
      time: '03:10',
      latitude: -31.420134,
      longitude: -64.188771,
    });
    expect(sms).toBe('GARITA PANICO A7C2E91F T:483920 03:10 -31.42013,-64.18877');
  });

  it('con el destino de respaldo suma el predio sin tildes, hasta 30 caracteres, y el mapa', () => {
    const sms = buildPanicSms({
      alertId,
      shiftCode: '483920',
      time: '03:10',
      latitude: -31.420134,
      longitude: -64.188771,
      backup: { siteName: 'Depósito Ruta 9 — Nave Logística Córdoba Norte' },
    });
    expect(sms).toContain(' Deposito Ruta 9 Nave Logistica ');
    expect(sms).toMatch(/maps\.google\.com\/\?q=-31\.42013,-64\.18877$/);
    expect(sms.length).toBeLessThanOrEqual(160);
    expect(sms).toMatch(/^[\x20-\x7e]+$/);
  });

  it('sin ubicación lo indica y se vuelve a leer', () => {
    const sms = buildPanicSms({
      alertId,
      shiftCode: '483920',
      time: '03:10',
      latitude: null,
      longitude: null,
    });
    expect(parsePanicSms(sms)).toEqual({
      shortId: panicShortId(alertId),
      shiftCode: '483920',
      time: '03:10',
      latitude: null,
      longitude: null,
    });
  });

  it('lee las coordenadas y rechaza textos ajenos', () => {
    expect(parsePanicSms('GARITA PANICO A7C2E91F T:483920 03:10 -31.42013,-64.18877')).toEqual({
      shortId: 'A7C2E91F',
      shiftCode: '483920',
      time: '03:10',
      latitude: -31.42013,
      longitude: -64.18877,
    });
    expect(parsePanicSms('Hola, todo bien?')).toBeNull();
  });
});
