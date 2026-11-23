import type { DragDelta } from '@/lib/interaction/use-pointer-drag';

/** Lo que mide un paso de columna y de fila en píxeles, para traducir el puntero a celdas. */
export interface GridMetrics {
  columnStep: number;
  rowStep: number;
}

// Respaldo si el navegador no informa medidas (p. ej. en tests): 48 px de fila y 24 de separación.
const FALLBACK_ROW = 48;
const FALLBACK_GAP = 24;

const px = (value: string, fallback: number) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Mide la grilla al empezar un gesto: ancho real, columnas, alto de fila y separaciones. */
export function readGridMetrics(grid: HTMLElement, columns: number): GridMetrics {
  const style = window.getComputedStyle(grid);
  const columnGap = px(style.columnGap, FALLBACK_GAP);
  const rowGap = px(style.rowGap, FALLBACK_GAP);
  const rowHeight = px(style.gridAutoRows, FALLBACK_ROW);
  const width = grid.getBoundingClientRect().width;
  const column = columns > 0 ? (width - columnGap * (columns - 1)) / columns : 0;
  return { columnStep: Math.max(1, column + columnGap), rowStep: Math.max(1, rowHeight + rowGap) };
}

/** Celdas que recorrió el puntero: se redondea, así el bloque cambia de celda a mitad de camino. */
export function deltaToCells(delta: DragDelta, metrics: GridMetrics): { dx: number; dy: number } {
  return {
    dx: Math.round(delta.dx / metrics.columnStep),
    dy: Math.round(delta.dy / metrics.rowStep),
  };
}
