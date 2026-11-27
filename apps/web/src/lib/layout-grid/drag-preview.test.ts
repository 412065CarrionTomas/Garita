import type { LayoutItem } from '@garita/shared';
import { dragPreviewGeometry, type DragPreview } from './drag-preview';

const metrics = { columnStep: 50, rowStep: 24, gutter: 24 };
const start: LayoutItem = {
  id: 'a',
  x: 2,
  y: 4,
  w: 4,
  h: 6,
  hidden: false,
  presentation: 'table',
  settings: {},
};
const limits = { min: { w: 2, h: 3 }, max: { w: 8, h: 10 }, default: { w: 4, h: 6 } };
const preview = (kind: DragPreview['kind'], dx: number, dy: number): DragPreview => ({
  kind,
  start,
  metrics,
  delta: { dx, dy },
});

describe('mover', () => {
  it('sigue al puntero aunque el motor ya haya cambiado la celda', () => {
    // El puntero recorrió 130 × 40 px; el motor ya lo pasó a la columna 5 y la fila 6.
    const placed = { ...start, x: 5, y: 6 };
    expect(dragPreviewGeometry(preview('move', 130, 40), placed, limits, 24)).toEqual({
      kind: 'move',
      dx: 130 - 3 * 50,
      dy: 40 - 2 * 24,
    });
  });
});

describe('redimensionar', () => {
  it('crece de a píxel desde el tamaño de inicio', () => {
    // 4 × 6 celdas = 176 × 120 px.
    expect(dragPreviewGeometry(preview('resize', 13, 7), start, limits, 24)).toEqual({
      kind: 'resize',
      width: 189,
      height: 127,
    });
  });

  it('no pasa de los límites del bloque ni del borde de la grilla', () => {
    expect(dragPreviewGeometry(preview('resize', -999, 999), start, limits, 24)).toEqual({
      kind: 'resize',
      width: 2 * 50 - 24,
      height: 10 * 24 - 24,
    });
    // En 7 columnas, desde la columna 2 entran 5 aunque el bloque admita 8.
    expect(dragPreviewGeometry(preview('resize', 999, 0), start, limits, 7)).toMatchObject({
      width: 5 * 50 - 24,
    });
  });
});
