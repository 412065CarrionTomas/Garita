import { checkpointsResponseSchema } from './checkpoints';

it('devuelve las coordenadas como número aunque la API las mande como texto', () => {
  const [point] = checkpointsResponseSchema.parse([
    {
      id: 'a',
      siteId: 's',
      name: 'Alfa',
      latitude: '-31.3504',
      longitude: '-64.287',
      toleranceRadiusMeters: 30,
      stickerLocation: null,
      isIndoor: false,
      qrVersion: 1,
      status: 'active',
    },
  ]);
  // Rondas suma coordenadas de esta caché: con texto, el punto medio daba NaN.
  expect(point?.latitude).toBe(-31.3504);
  expect(point?.longitude).toBe(-64.287);
});
