import { normalizeArPhone, sameArPhone, smsWebhookBodySchema } from './sms-inbound';

describe('normalizeArPhone', () => {
  it.each([
    ['+54 9 351 123-4567', '3511234567'],
    ['+543511234567', '3511234567'],
    ['0351 15 1234567', '3511234567'],
    ['3511234567', '3511234567'],
    ['+54 9 11 1234-5678', '1112345678'],
    ['011 15 1234 5678', '1112345678'],
    ['0054 9 2966 123456', '2966123456'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeArPhone(raw)).toBe(expected);
  });

  it('recognizes the number loaded with the 9 and reported without it (HU-37)', () => {
    expect(sameArPhone('+54 9 351 1234567', '+543511234567')).toBe(true);
    expect(sameArPhone('+54 9 351 1234567', '+54 9 351 7654321')).toBe(false);
  });

  it('a number without digits is never the same as another one without digits', () => {
    expect(sameArPhone('-------', '()  ()  ()')).toBe(false);
    expect(
      smsWebhookBodySchema.safeParse({
        id: 'm1',
        from: '-------',
        text: 'x',
        receivedAt: '2035-01-01T12:00:00Z',
      }).success,
    ).toBe(false);
  });
});
