import { cellsToPixels, deltaToCells, readGridMetrics } from './grid-metrics';

it('traduce el desplazamiento a celdas cambiando a mitad de camino', () => {
  const metrics = { columnStep: 100, rowStep: 24, gutter: 24 };
  expect(deltaToCells({ dx: 49, dy: 11 }, metrics)).toEqual({ dx: 0, dy: 0 });
  expect(deltaToCells({ dx: 51, dy: 13 }, metrics)).toEqual({ dx: 1, dy: 1 });
  expect(deltaToCells({ dx: -260, dy: -50 }, metrics)).toEqual({ dx: -3, dy: -2 });
});

it('mide columnas y filas; las filas no llevan separación propia', () => {
  const grid = document.createElement('div');
  grid.style.columnGap = '24px';
  grid.style.rowGap = '0px';
  grid.style.gridAutoRows = '24px';
  grid.getBoundingClientRect = () => ({ width: 1272 }) as DOMRect;
  // 24 columnas de (1272 - 23 × 24) / 24 = 30 px, más 24 de separación.
  expect(readGridMetrics(grid, 24)).toEqual({ columnStep: 54, rowStep: 24, gutter: 24 });
});

it('calcula el tamaño en píxeles de un bloque sin la separación final', () => {
  const metrics = { columnStep: 54, rowStep: 24, gutter: 24 };
  expect(cellsToPixels({ w: 2, h: 3 }, metrics)).toEqual({ width: 84, height: 48 });
});
