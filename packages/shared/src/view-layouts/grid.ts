/**
 * Geometría de la grilla de bloques: funciones puras, sin conocer pantallas ni bloques.
 * Coordenadas en celdas: `x` columna y `y` fila desde 0; `w` y `h` en celdas.
 */
export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Dos rectángulos se superponen si comparten al menos una celda (tocarse por un borde no cuenta). */
export function rectsOverlap(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Primer par de índices superpuestos, o `null` si no hay ninguno. */
export function findOverlap(rects: readonly GridRect[]): [number, number] | null {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (a && b && rectsOverlap(a, b)) return [i, j];
    }
  }
  return null;
}

/** Fila donde termina el bloque más bajo: la altura total ocupada. */
export function gridHeight(rects: readonly GridRect[]): number {
  return rects.reduce((max, rect) => Math.max(max, rect.y + rect.h), 0);
}

/** Índices de los bloques en orden de lectura: fila, después columna y, a igualdad, el de entrada. */
export function readingOrder(rects: readonly GridRect[]): number[] {
  return rects
    .map((rect, index) => ({ rect, index }))
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.index - b.index)
    .map(({ index }) => index);
}

/**
 * Compactación vertical con un orden de prioridad dado (índices de `items`): cada bloque, en ese
 * orden, sube desde su fila hasta chocar con uno ya ubicado o con el borde superior, y si arranca
 * superpuesto baja hasta quedar libre. Nunca salta por encima de otro bloque de sus columnas.
 * Devuelve copias en el mismo orden de entrada; los índices que falten en `order` no se ubican.
 */
export function compactInOrder<T extends GridRect>(
  items: readonly T[],
  order: readonly number[],
): T[] {
  const placed: T[] = [];
  const result: T[] = [...items];
  for (const index of order) {
    const item = items[index];
    if (!item) continue;
    const fits = (y: number) => !placed.some((other) => rectsOverlap({ ...item, y }, other));
    let y = Math.max(0, item.y);
    while (y > 0 && fits(y - 1)) y--;
    while (!fits(y)) y++;
    const moved = { ...item, y };
    placed.push(moved);
    result[index] = moved;
  }
  return result;
}

/** Compactación vertical en orden de lectura: no quedan huecos encima de ningún bloque. */
export function compactVertical<T extends GridRect>(items: readonly T[]): T[] {
  return compactInOrder(items, readingOrder(items));
}
