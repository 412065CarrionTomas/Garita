import {
  compactInOrder,
  compactLayoutItems,
  readingOrder,
  rectsOverlap,
  type LayoutItem,
  type ViewCatalog,
} from '@garita/shared';

/*
 * Motor del editor de bloques: funciones puras sobre el diseño de una pantalla, sin React ni DOM.
 * Reglas:
 * - Inmutables: nunca modifican lo recibido. Si la acción no cambia nada devuelven la MISMA
 *   referencia, así quien las use puede saltear renders y no apilar pasos vacíos en "deshacer".
 * - Compactación vertical: después de cada acción ningún bloque visible queda con hueco encima.
 * - Un bloque que se mueve o cambia de tamaño se ubica antes que los bloques cuya mitad
 *   superior alcanza; los demás se acomodan a su alrededor. Eso permite bajar un bloque por
 *   debajo de otro aunque la compactación tienda a subirlo.
 * - Los bloques ocultos no ocupan lugar y conservan su posición para cuando vuelvan.
 */

export interface Cell {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}
export type Direction = 'up' | 'down' | 'left' | 'right';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function indexOf(items: readonly LayoutItem[], id: string): number {
  return items.findIndex((item) => item.id === id);
}

/** Comparten al menos una columna. */
function shareColumns(a: LayoutItem, b: LayoutItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w;
}

/**
 * Ubica el bloque `index` ya actualizado (posición o tamaño nuevos) y recompacta: va antes de
 * cada bloque cuya mitad superior alcanza y después del resto, en orden de lectura.
 */
function relocate(items: readonly LayoutItem[], index: number): LayoutItem[] {
  const target = items[index];
  if (!target) return [...items];
  const others = readingOrder(items).filter((i) => i !== index && !items[i]?.hidden);
  const before = others.findIndex((i) => {
    const other = items[i];
    return other !== undefined && target.y < other.y + other.h / 2;
  });
  const order = [...others];
  order.splice(before === -1 ? order.length : before, 0, index);
  return compactInOrder(items, order);
}

function replaceAt(items: readonly LayoutItem[], index: number, item: LayoutItem): LayoutItem[] {
  const next = [...items];
  next[index] = item;
  return next;
}

/** Igualdad de diseño: misma posición, tamaño, visibilidad, presentación y ajustes por bloque. */
export function sameLayout(a: readonly LayoutItem[], b: readonly LayoutItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((item) => [item.id, item]));
  return a.every((item) => {
    const other = byId.get(item.id);
    if (!other) return false;
    return (
      item.x === other.x &&
      item.y === other.y &&
      item.w === other.w &&
      item.h === other.h &&
      item.hidden === other.hidden &&
      item.presentation === other.presentation &&
      sameSettings(item.settings, other.settings)
    );
  });
}

function sameSettings(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]))
  );
}

/** Devuelve `next` salvo que sea igual a `items`: así una acción sin efecto conserva la referencia. */
function keepIfSame(items: readonly LayoutItem[], next: LayoutItem[]): readonly LayoutItem[] {
  return sameLayout(items, next) ? items : next;
}

/** Mueve un bloque visible a la celda de destino de su esquina superior izquierda. */
export function moveItem(
  catalog: ViewCatalog,
  items: readonly LayoutItem[],
  id: string,
  to: Cell,
): readonly LayoutItem[] {
  const index = indexOf(items, id);
  const item = items[index];
  if (!item || item.hidden) return items;
  const moved = {
    ...item,
    x: clamp(Math.round(to.x), 0, catalog.columns - item.w),
    y: Math.max(0, Math.round(to.y)),
  };
  return keepIfSame(items, relocate(replaceAt(items, index, moved), index));
}

/**
 * Cambia el tamaño de un bloque visible dentro de los límites de su definición y de la grilla.
 * El bloque crece hacia la derecha y hacia abajo: su esquina superior izquierda no se mueve.
 */
export function resizeItem(
  catalog: ViewCatalog,
  items: readonly LayoutItem[],
  id: string,
  to: Size,
): readonly LayoutItem[] {
  const index = indexOf(items, id);
  const item = items[index];
  const widget = Object.hasOwn(catalog.widgets, id) ? catalog.widgets[id] : undefined;
  if (!item || item.hidden || !widget) return items;
  const { min, max } = widget.size;
  const resized = {
    ...item,
    w: clamp(Math.round(to.w), min.w, Math.min(max.w, catalog.columns - item.x)),
    h: clamp(Math.round(to.h), min.h, max.h),
  };
  return keepIfSame(items, relocate(replaceAt(items, index, resized), index));
}

/**
 * Un paso de teclado. Izquierda y derecha corren el bloque una columna; arriba y abajo lo
 * intercambian con el bloque más cercano que comparte columnas en esa dirección (con
 * compactación vertical, bajar una sola fila no cambiaría nada).
 */
export function stepItem(
  catalog: ViewCatalog,
  items: readonly LayoutItem[],
  id: string,
  direction: Direction,
): readonly LayoutItem[] {
  const item = items[indexOf(items, id)];
  if (!item || item.hidden) return items;
  if (direction === 'left' || direction === 'right')
    return moveItem(catalog, items, id, {
      x: item.x + (direction === 'left' ? -1 : 1),
      y: item.y,
    });
  const neighbours = items.filter(
    (other) =>
      other.id !== id &&
      !other.hidden &&
      shareColumns(item, other) &&
      (direction === 'up' ? other.y + other.h <= item.y : other.y >= item.y + item.h),
  );
  if (neighbours.length === 0) return items;
  const nearest = neighbours.reduce((best, other) =>
    direction === 'up'
      ? other.y + other.h > best.y + best.h
        ? other
        : best
      : other.y < best.y
        ? other
        : best,
  );
  // Arriba: la fila del vecino lo ubica antes que él. Abajo: su borde inferior, después.
  const y = direction === 'up' ? nearest.y : nearest.y + nearest.h;
  return moveItem(catalog, items, id, { x: item.x, y });
}

/** Un paso de teclado de tamaño: derecha e izquierda cambian el ancho; abajo y arriba, el alto. */
export function stepSize(
  catalog: ViewCatalog,
  items: readonly LayoutItem[],
  id: string,
  direction: Direction,
): readonly LayoutItem[] {
  const item = items[indexOf(items, id)];
  if (!item) return items;
  const delta = direction === 'right' || direction === 'down' ? 1 : -1;
  const horizontal = direction === 'left' || direction === 'right';
  return resizeItem(catalog, items, id, {
    w: item.w + (horizontal ? delta : 0),
    h: item.h + (horizontal ? 0 : delta),
  });
}

/** Oculta o muestra un bloque. Al volver, reaparece donde estaba y los demás se acomodan. */
export function setHidden(
  items: readonly LayoutItem[],
  id: string,
  hidden: boolean,
): readonly LayoutItem[] {
  const index = indexOf(items, id);
  const item = items[index];
  if (!item || item.hidden === hidden) return items;
  const next = replaceAt(items, index, { ...item, hidden });
  return hidden ? compactLayoutItems(next) : relocate(next, index);
}

/** Cambia cómo se muestra un bloque; ignora presentaciones que el bloque no ofrece. */
export function setPresentation(
  catalog: ViewCatalog,
  items: readonly LayoutItem[],
  id: string,
  presentation: string,
): readonly LayoutItem[] {
  const index = indexOf(items, id);
  const item = items[index];
  const widget = Object.hasOwn(catalog.widgets, id) ? catalog.widgets[id] : undefined;
  if (!item || !widget?.presentations.includes(presentation) || item.presentation === presentation)
    return items;
  return replaceAt(items, index, { ...item, presentation });
}

/** Combina ajustes nuevos con los actuales; ignora el cambio si el resultado no es válido. */
export function setSettings(
  catalog: ViewCatalog,
  items: readonly LayoutItem[],
  id: string,
  patch: Record<string, unknown>,
): readonly LayoutItem[] {
  const index = indexOf(items, id);
  const item = items[index];
  const widget = Object.hasOwn(catalog.widgets, id) ? catalog.widgets[id] : undefined;
  if (!item || !widget) return items;
  const parsed = widget.settings.safeParse({ ...item.settings, ...patch });
  if (!parsed.success) return items;
  return keepIfSame(items, replaceAt(items, index, { ...item, settings: parsed.data }));
}

/**
 * Adapta un diseño a menos columnas (tablet, celular) sin guardarlo: escala anchos y columnas,
 * y recompacta en el orden de lectura original. Con una sola columna, apila en ese orden.
 */
export function scaleLayout(
  items: readonly LayoutItem[],
  fromColumns: number,
  toColumns: number,
): LayoutItem[] {
  if (toColumns >= fromColumns) return [...items];
  const ratio = toColumns / fromColumns;
  const order = readingOrder(items).filter((index) => !items[index]?.hidden);
  const scaled = items.map((item) => {
    const w = clamp(Math.round(item.w * ratio), 1, toColumns);
    return { ...item, w, x: clamp(Math.round(item.x * ratio), 0, toColumns - w) };
  });
  // Escalar puede superponer bloques que estaban lado a lado: el orden de lectura los resuelve.
  return compactInOrder(scaled, order);
}

/** Bloques visibles que se superponen; vacío en un diseño sano. Útil para afirmar en tests. */
export function overlappingIds(items: readonly LayoutItem[]): string[] {
  const visible = items.filter((item) => !item.hidden);
  return visible.flatMap((a, i) =>
    visible.slice(i + 1).flatMap((b) => (rectsOverlap(a, b) ? [`${a.id}+${b.id}`] : [])),
  );
}
