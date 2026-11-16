/** Exact pesos, half up to cents. The caller supplies calendar days in the company timezone. */
export function proratePlanChange(input: {
  currentPrice: string;
  newPrice: string;
  remainingDays: string;
  cycleDays: string;
  inTrial?: boolean;
}): string {
  const cents = (value: string) => {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new RangeError('Precio inválido');
    const [whole = '', fraction = ''] = value.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  };
  if (!/^\d+$/.test(input.remainingDays) || !/^[1-9]\d*$/.test(input.cycleDays))
    throw new RangeError('Días inválidos');
  const remaining = BigInt(input.remainingDays);
  const cycle = BigInt(input.cycleDays);
  if (remaining > cycle) throw new RangeError('Días fuera del ciclo');
  const difference = cents(input.newPrice) - cents(input.currentPrice);
  if (input.inTrial || difference <= 0n) return '0.00';
  const rounded = (difference * remaining * 2n + cycle) / (2n * cycle);
  return `${rounded / 100n}.${String(rounded % 100n).padStart(2, '0')}`;
}
