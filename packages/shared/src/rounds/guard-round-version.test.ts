import { GUARD_ROUND_VERSIONS_MAX, guardRoundVersionsQuerySchema } from './guard-round-version';

it('acepta ids separados por coma sin repetir y con tope por pedido', () => {
  expect(guardRoundVersionsQuerySchema.parse({ ids: 'a,b,a,' }).ids).toEqual(['a', 'b']);
  expect(guardRoundVersionsQuerySchema.safeParse({ ids: '' }).success).toBe(false);
  const tooMany = Array.from({ length: GUARD_ROUND_VERSIONS_MAX + 1 }, (_, i) => `v${i}`).join(',');
  expect(guardRoundVersionsQuerySchema.safeParse({ ids: tooMany }).success).toBe(false);
});
