import { parsePhoton } from './photon';

describe('parsePhoton', () => {
  it('convierte una respuesta válida en sugerencias con [lng, lat] invertido', () => {
    const suggestions = parsePhoton({
      features: [
        {
          geometry: { coordinates: [-64.18, -31.42] },
          properties: {
            street: 'Av. Colón',
            housenumber: '1200',
            city: 'Córdoba',
            state: 'Córdoba',
          },
        },
      ],
    });
    expect(suggestions).toEqual([
      { label: 'Av. Colón 1200, Córdoba', latitude: -31.42, longitude: -64.18 },
    ]);
  });

  it('devuelve una lista vacía si la respuesta no cumple el esquema', () => {
    expect(parsePhoton({ features: [{ geometry: { coordinates: 'roto' } }] })).toEqual([]);
    expect(parsePhoton(null)).toEqual([]);
  });
});
