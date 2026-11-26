import { parsePhoton, parseStreetAddress } from './photon';

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

describe('parseStreetAddress', () => {
  const feature = (lng: number, lat: number, properties: Record<string, string>) => ({
    geometry: { coordinates: [lng, lat] },
    properties,
  });
  // 0,0001° de latitud ≈ 11 m.
  it('devuelve calle y número del domicilio más cercano dentro del radio', () => {
    const body = {
      features: [
        feature(-64.18, -31.4202, { street: 'Av. Colón', housenumber: '1250' }),
        feature(-64.18, -31.4201, { street: 'Av. Colón', housenumber: '1200' }),
      ],
    };
    expect(parseStreetAddress(body, -31.42, -64.18, 30)).toBe('Av. Colón 1200');
  });

  it('no usa una calle sin número ni un domicilio fuera del radio', () => {
    const body = {
      features: [
        feature(-64.18, -31.42, { street: 'Ruta 5' }),
        feature(-64.18, -31.421, { street: 'Los Álamos', housenumber: '40' }),
      ],
    };
    expect(parseStreetAddress(body, -31.42, -64.18, 30)).toBeNull();
    expect(parseStreetAddress(null, -31.42, -64.18, 30)).toBeNull();
  });
});
