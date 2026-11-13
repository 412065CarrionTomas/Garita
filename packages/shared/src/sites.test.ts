import { siteInputSchema } from './sites';

it('exige ubicar el predio y permite ubicaciones sobre un solo eje cero', () => {
  const site = { clientId: 'c1', name: 'Predio', address: 'Calle', latitude: 0, longitude: 0 };
  expect(siteInputSchema.safeParse(site).success).toBe(false);
  expect(siteInputSchema.safeParse({ ...site, longitude: -58 }).success).toBe(true);
  expect(siteInputSchema.safeParse({ ...site, latitude: -34 }).success).toBe(true);
});
