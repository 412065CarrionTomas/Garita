import { niceMax } from './compliance-tone';

it('redondea el tope del eje a cuatro tramos que cubren el máximo', () => {
  expect(niceMax(1214)).toBe(1600);
  expect(niceMax(42)).toBe(44);
  expect(niceMax(100)).toBe(120);
  expect(niceMax(0)).toBe(1);
});
