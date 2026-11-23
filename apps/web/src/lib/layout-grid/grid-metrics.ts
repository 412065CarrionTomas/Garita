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
 * Alto de una fila y separación entre bloques (escala del sistema). Columnas y filas no llevan
 * hueco propio: cada bloque deja `GRID_GUTTER` a la derecha y abajo. Así las celdas pueden ser
 * finas (8 px de alto) y los bloques ubicarse y crecer casi al píxel sin sumar un hueco por celda.
 */
export const GRID_ROW = 8;
export const GRID_GUTTER = 24;

const px = (value: string, fallback: number) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Mide la grilla al empezar un gesto. El ancho medido incluye la separación del último bloque
 * (la grilla se extiende `GRID_GUTTER` a la derecha), así cada columna mide ancho / columnas.
 */
export function readGridMetrics(grid: HTMLElement, columns: number): GridMetrics {
  const style = window.getComputedStyle(grid);
  const columnGap = px(style.columnGap, 0);
  const rowGap = px(style.rowGap, 0);
  const rowHeight = px(style.gridAutoRows, GRID_ROW);
  const width = grid.getBoundingClientRect().width;
  const column = columns > 0 ? (width - columnGap * (columns - 1)) / columns : 0;
  return {
    columnStep: Math.max(1, column + columnGap),
    rowStep: Math.max(1, rowHeight + rowGap),
    gutter: GRID_GUTTER,
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
