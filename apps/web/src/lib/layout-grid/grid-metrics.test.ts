import { deltaToCells, readGridMetrics } from './grid-metrics';

it('traduce el desplazamiento a celdas cambiando a mitad de camino', () => {
  const metrics = { columnStep: 100, rowStep: 72 };
  expect(deltaToCells({ dx: 49, dy: 35 }, metrics)).toEqual({ dx: 0, dy: 0 });
  expect(deltaToCells({ dx: 51, dy: 37 }, metrics)).toEqual({ dx: 1, dy: 1 });
  expect(deltaToCells({ dx: -260, dy: -150 }, metrics)).toEqual({ dx: -3, dy: -2 });
});

it('mide columnas y filas con las separaciones de la grilla', () => {
  const grid = document.createElement('div');
  grid.style.columnGap = '24px';
  grid.style.rowGap = '24px';
  grid.style.gridAutoRows = '48px';
  grid.getBoundingClientRect = () => ({ width: 1236 }) as DOMRect;
  // 12 columnas de (1236 - 11 × 24) / 12 = 81 px, más 24 de separación.
  expect(readGridMetrics(grid, 12)).toEqual({ columnStep: 105, rowStep: 72 });
});
