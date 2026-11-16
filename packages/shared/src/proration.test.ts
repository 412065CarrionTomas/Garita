import { proratePlanChange } from './proration';

describe('prorrateo exacto', () => {
  it.each([
    ['20', '30', '26666.67'],
    ['20', '28', '28571.43'],
    ['20', '31', '25806.45'],
    ['1', '30', '1333.33'],
    ['0', '30', '0.00'],
    ['30', '30', '40000.00'],
  ])('%s de %s días', (remainingDays, cycleDays, expected) => {
    expect(
      proratePlanChange({ currentPrice: '50000', newPrice: '90000.00', remainingDays, cycleDays }),
    ).toBe(expected);
  });
  it('redondea el medio hacia arriba y conserva centavos exactos', () => {
    expect(
      proratePlanChange({
        currentPrice: '0',
        newPrice: '0.01',
        remainingDays: '1',
        cycleDays: '2',
      }),
    ).toBe('0.01');
  });
  it.each([
    { currentPrice: '50000', newPrice: '50000' },
    { currentPrice: '90000', newPrice: '50000' },
    { currentPrice: '50000', newPrice: '90000', inTrial: true },
  ])('sin cobro: %j', (prices) => {
    expect(proratePlanChange({ ...prices, remainingDays: '20', cycleDays: '30' })).toBe('0.00');
  });
  it.each([
    { currentPrice: '-1' },
    { newPrice: '1.001' },
    { remainingDays: '1.5' },
    { cycleDays: '0' },
    { remainingDays: '31' },
  ])('rechaza %j', (invalid) => {
    expect(() =>
      proratePlanChange({
        currentPrice: '0',
        newPrice: '1',
        remainingDays: '1',
        cycleDays: '30',
        ...invalid,
      }),
    ).toThrow(RangeError);
  });
});
