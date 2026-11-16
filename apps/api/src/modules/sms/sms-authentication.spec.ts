import { authenticatePanicSms } from './sms-authentication';
import { smsTriggeredAt } from './sms-inbound.service';

const candidate = {
  id: 'shift',
  companyId: 'north',
  panicSmsCode: '123456',
  assignmentId: 'assignment',
  guardId: 'guard',
  phone: '+5493511234567',
};
const text = 'GARITA PANICO ABCD1234 T:123456 03:10 -31.42013,-64.18877';
describe('autenticación de pánico SMS', () => {
  it('CA1/CA7: valida el código y normaliza el 9 argentino', () => {
    expect(authenticatePanicSms(text, '+54 3511234567', [candidate])).toMatchObject({
      result: 'valid',
      phoneMismatch: false,
    });
  });
  it('CA6: prioriza el código aunque no coincida el remitente', () => {
    expect(authenticatePanicSms(text, '+5491112345678', [candidate])).toMatchObject({
      result: 'valid',
      phoneMismatch: true,
    });
  });
  it('CA2: texto a mano y código incorrecto con teléfono conocido son no verificados', () => {
    for (const message of ['Ayuda portón', text.replace('123456', '999999')])
      expect(authenticatePanicSms(message, candidate.phone, [candidate]).result).toBe('unverified');
  });
  it('CA3: desconoce números ajenos y nunca adivina entre dos turnos o códigos', () => {
    expect(authenticatePanicSms('Ayuda', '+5491112345678', [candidate]).result).toBe('unknown');
    const other = { ...candidate, id: 'other' };
    expect(authenticatePanicSms('Ayuda', candidate.phone, [candidate, other]).result).toBe(
      'unknown',
    );
    expect(authenticatePanicSms(text, candidate.phone, [candidate, other]).result).toBe('unknown');
  });
  it('infiere la fecha cercana al cruce de medianoche en la zona del turno', () => {
    expect(
      smsTriggeredAt(
        '23:59',
        new Date('2035-01-02T03:01:00Z'),
        'America/Argentina/Buenos_Aires',
      ).toISOString(),
    ).toBe('2035-01-02T02:59:00.000Z');
  });
});
