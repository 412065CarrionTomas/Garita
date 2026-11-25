import type { StyleSpecification } from 'maplibre-gl';
import { recolor, withSatellite } from './map-style';

const base: StyleSpecification = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.test' } },
  layers: [
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
    {
      id: 'place',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      layout: { 'text-field': '{name}' },
    },
    { id: 'poi', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi' },
  ],
};

describe('recolor', () => {
  it('pinta el agua y las etiquetas con la paleta y descarta los comercios', () => {
    const light = recolor(base, false);
    const dark = recolor(base, true);
    expect(light.layers.map((layer) => layer.id)).toEqual(['water', 'place']);
    expect(light.layers[0]).toMatchObject({ paint: { 'fill-color': '#D6E0EC' } });
    expect(dark.layers[0]).toMatchObject({ paint: { 'fill-color': '#0C1322' } });
    expect(light.layers[1]).toMatchObject({
      layout: { 'text-field': ['coalesce', ['get', 'name:es'], ['get', 'name']] },
      paint: { 'text-halo-color': '#EEF0F2' },
    });
  });
});

describe('withSatellite', () => {
  it('pone la foto debajo, conserva solo las etiquetas y limita el zoom de la foto', () => {
    const hybrid = withSatellite(base, 'https://satellite.test/{z}/{y}/{x}');
    expect(hybrid.layers.map((layer) => layer.id)).toEqual(['satellite', 'place', 'poi']);
    expect(hybrid.sources.satellite).toMatchObject({
      type: 'raster',
      tiles: ['https://satellite.test/{z}/{y}/{x}'],
      maxzoom: 19,
      attribution: expect.stringContaining('Esri') as unknown,
    });
    expect(hybrid.sources.openmaptiles).toBe(base.sources.openmaptiles);
    expect(hybrid.layers[1]).toMatchObject({ paint: { 'text-color': '#FFFFFF' } });
  });
});
