import type { DragDelta } from '@/lib/interaction/use-pointer-drag';

/**
 * Medidas de la grilla en píxeles. Un bloque de `n` celdas mide `n × step − gutter`: la
 * separación entre bloques (`gutter`) es igual en horizontal y en vertical.
 */
export interface GridMetrics {
  columnStep: number;
  rowStep: number;
  gutter: number;
}

/**
 * Alto de una fila y separación entre bloques (escala del sistema). Las filas no llevan
 * separación propia: cada bloque deja `GRID_GUTTER` abajo, así las filas pueden ser chicas y los
 * bloques crecer de a pasos finos sin sumar una separación por fila.
 */
export const GRID_ROW = 24;
export const GRID_GUTTER = 24;

const px = (value: string, fallback: number) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Mide la grilla al empezar un gesto: ancho real, columnas, alto de fila y separaciones. */
export function readGridMetrics(grid: HTMLElement, columns: number): GridMetrics {
  const style = window.getComputedStyle(grid);
  const gutter = px(style.columnGap, GRID_GUTTER);
  const rowGap = px(style.rowGap, 0);
  const rowHeight = px(style.gridAutoRows, GRID_ROW);
  const width = grid.getBoundingClientRect().width;
  const column = columns > 0 ? (width - gutter * (columns - 1)) / columns : 0;
  return {
    columnStep: Math.max(1, column + gutter),
    rowStep: Math.max(1, rowHeight + rowGap),
    gutter,
  };
}

/** Celdas que recorrió el puntero: se redondea, así el bloque cambia de celda a mitad de camino. */
export function deltaToCells(delta: DragDelta, metrics: GridMetrics): { dx: number; dy: number } {
  return {
    dx: Math.round(delta.dx / metrics.columnStep),
    dy: Math.round(delta.dy / metrics.rowStep),
  };
}

/** Ancho y alto en píxeles de un bloque de `w × h` celdas. */
export function cellsToPixels(
  size: { w: number; h: number },
  metrics: GridMetrics,
): { width: number; height: number } {
  return {
    width: size.w * metrics.columnStep - metrics.gutter,
    height: size.h * metrics.rowStep - metrics.gutter,
  };
}
