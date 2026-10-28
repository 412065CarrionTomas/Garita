import { purgeExpiredRedeemAttempts } from './redeem-attempts';

describe('purgeExpiredRedeemAttempts', () => {
  it('elimina las claves de minutos anteriores y conserva las del minuto actual', () => {
    const attempts = new Map([
      ['192.0.2.1:100', 3],
      ['192.0.2.2:101', 1],
    ]);

    purgeExpiredRedeemAttempts(attempts, 101 * 60_000 + 5);

    expect(attempts).toEqual(new Map([['192.0.2.2:101', 1]]));
  });
});
