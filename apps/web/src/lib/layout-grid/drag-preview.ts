import type { LayoutItem, WidgetDefinition } from '@garita/shared';
import type { DragDelta } from '@/lib/interaction/use-pointer-drag';
import { cellsToPixels, type GridMetrics } from './grid-metrics';

/** Un gesto de puntero en curso: qué se hace, desde dónde empezó y cuánto se movió el puntero. */
export interface DragPreview {
  kind: 'move' | 'resize';
  start: LayoutItem;
  metrics: GridMetrics;
  delta: DragDelta;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Dónde se dibuja el bloque mientras se arrastra, en píxeles, para que siga al puntero sin saltos
 * aunque el diseño cambie de a celdas. `placed` es la celda que el motor le dio en este momento.
 * - Mover: desplazamiento desde la celda actual hasta donde está el puntero.
 * - Redimensionar: tamaño desde el de inicio más lo recorrido, dentro de los límites del bloque y
 *   del borde derecho de la grilla (los mismos que aplica el motor al soltar).
 */
export function dragPreviewGeometry(
  preview: DragPreview,
  placed: LayoutItem,
  limits: WidgetDefinition['size'] | undefined,
  columns: number,
): { kind: 'move'; dx: number; dy: number } | { kind: 'resize'; width: number; height: number } {
  const { start, metrics, delta } = preview;
  if (preview.kind === 'move')
    return {
      kind: 'move',
      dx: delta.dx - (placed.x - start.x) * metrics.columnStep,
      dy: delta.dy - (placed.y - start.y) * metrics.rowStep,
    };
  const from = cellsToPixels(start, metrics);
  const min = cellsToPixels(limits?.min ?? { w: 1, h: 1 }, metrics);
  const max = cellsToPixels(
    {
      w: Math.min(limits?.max.w ?? columns, columns - start.x),
      h: limits?.max.h ?? Number.POSITIVE_INFINITY,
    },
    metrics,
  );
  return {
    kind: 'resize',
    width: clamp(from.width + delta.dx, min.width, max.width),
    height: clamp(from.height + delta.dy, min.height, max.height),
  };
}
