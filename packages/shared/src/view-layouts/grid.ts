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

/**
 * Compactación vertical: cada bloque sube hasta chocar con otro o con el borde superior, sin
 * huecos encima. Se procesan en orden de lectura (fila y después columna), así se respeta el
 * orden relativo; si un bloque arranca superpuesto, baja hasta quedar libre. Devuelve copias en
 * el mismo orden de entrada.
 */
export function compactVertical<T extends GridRect>(items: readonly T[]): T[] {
  const order = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.y - b.item.y || a.item.x - b.item.x || a.index - b.index);
  const placed: T[] = [];
  const result: T[] = [...items];
  for (const { item, index } of order) {
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
