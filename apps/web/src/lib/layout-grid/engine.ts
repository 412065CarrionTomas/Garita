import {
  compactInOrder,
  exceedsRows,
  LAYOUT_LIMITS,
  readingOrder,
  rectsOverlap,
  settleLayoutItems,
  widgetMinSize,
  type LayoutItem,
  type ViewCatalog,
  type WidgetDefinition,
} from '@garita/shared';

/*
 * Motor del editor de bloques: funciones puras sobre el diseño de una pantalla, sin React ni DOM.
 * Reglas:
 * - Inmutables: nunca modifican lo recibido. Si la acción no cambia nada devuelven la MISMA
 *   referencia, así quien las use puede saltear renders y no apilar pasos vacíos en "deshacer".
 * - Ubicación libre: un bloque que se mueve o cambia de tamaño queda donde el usuario lo pone.
 *   Los que pisa bajan lo justo (en cascada) y nadie sube: los huecos los decide el usuario.
 * - Los tamaños respetan el mínimo de la presentación del bloque y el máximo del bloque.
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

/**
 * Cuánto mueve o redimensiona una flecha del teclado: unas 48 columnas por ancho de grilla y 3
 * filas. Con la grilla del Resumen (96 columnas, filas de 8 px) son unos 30 × 24 px por paso.
 */
export function keyboardStep(catalog: ViewCatalog): { columns: number; rows: number } {
  return { columns: Math.max(1, Math.round(catalog.columns / 48)), rows: 3 };
}

function widgetOf(catalog: ViewCatalog, id: string): WidgetDefinition | undefined {
  return Object.hasOwn(catalog.widgets, id) ? catalog.widgets[id] : undefined;
}

function indexOf(items: readonly LayoutItem[], id: string): number {
  return items.findIndex((item) => item.id === id);
}

/**
 * Pone `item` en `index`, lo deja donde está y baja lo justo a los que pisa (ver
 * `settleLayoutItems`). Devuelve null si la cascada pasa el tope de filas que admite la API.
 */
function relocate(
  items: readonly LayoutItem[],
  index: number,
  item: LayoutItem,
): LayoutItem[] | null {
  const next = settleLayoutItems(replaceAt(items, index, item), index);
  return exceedsRows(next) ? null : next;
}

/**
 * Como `relocate`, pero si en su lugar empujaría a alguien más allá del tope, lo pone en el primer
 * hueco libre de su columna (o, si no hay, de la izquierda), donde no pisa a nadie: mostrar un
 * bloque o cambiar su presentación no se pierde en silencio. Sin hueco, no hace nada.
 */
function relocateOrFill(
  items: readonly LayoutItem[],
  index: number,
  item: LayoutItem,
): readonly LayoutItem[] {
  const placed = relocate(items, index, item);
  if (placed) return placed;
  const others = items.filter((other, i) => i !== index && !other.hidden);
  for (const x of new Set([item.x, 0]))
    for (let y = 0; y <= LAYOUT_LIMITS.maxRows; y++) {
      const candidate = { ...item, x, y };
      if (!others.some((other) => rectsOverlap(candidate, other)))
        return replaceAt(items, index, candidate);
    }
  return items;
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
function keepIfSame(
  items: readonly LayoutItem[],
  next: readonly LayoutItem[],
): readonly LayoutItem[] {
  return sameLayout(items, next) ? items : next;
}

/**
 * Mueve un bloque visible a la celda de destino de su esquina superior izquierda. Durante un
 * gesto, `items` es el diseño de antes del gesto y `current` el último paso: si el destino pasa
 * el tope de filas, el bloque se queda en `current` en vez de volver al inicio del gesto.
 */
export function moveItem(
  catalog: ViewCatalog,
  items: readonly LayoutItem[],
  id: string,
  to: Cell,
  current: readonly LayoutItem[] = items,
): readonly LayoutItem[] {
  const index = indexOf(items, id);
  const item = items[index];
  if (!item || item.hidden) return current;
  const moved = {
    ...item,
    x: clamp(Math.round(to.x), 0, catalog.columns - item.w),
    y: clamp(Math.round(to.y), 0, LAYOUT_LIMITS.maxRows),
  };
  const next = relocate(items, index, moved);
  return next ? keepIfSame(current, next) : current;
}

/**
 * Cambia el tamaño de un bloque visible dentro de los límites de su definición y de la grilla.
 * El bloque crece hacia la derecha y hacia abajo: su esquina superior izquierda no se mueve.
 * `current` funciona como en `moveItem`.
 */
export function resizeItem(
  catalog: ViewCatalog,
  items: readonly LayoutItem[],
  id: string,
  to: Size,
  current: readonly LayoutItem[] = items,
): readonly LayoutItem[] {
  const index = indexOf(items, id);
  const item = items[index];
  const widget = widgetOf(catalog, id);
  if (!item || item.hidden || !widget) return current;
  const { max } = widget.size;
  const min = widgetMinSize(widget, item.presentation);
  const resized = {
    ...item,
    w: clamp(Math.round(to.w), min.w, Math.min(max.w, catalog.columns - item.x)),
    h: clamp(Math.round(to.h), min.h, max.h),
  };
  const next = relocate(items, index, resized);
  return next ? keepIfSame(current, next) : current;
}

/**
 * Un paso de teclado: mueve el bloque `keyboardStep` en esa dirección; los que pisa bajan. El
 * destino sale de `items` y se aplica sobre `base` (el diseño de antes del gesto, si lo hay): así
 * los empujados vuelven a su lugar si el bloque retrocede, como con el puntero.
 */
export function stepItem(
  catalog: ViewCatalog,
  items: readonly LayoutItem[],
  id: string,
  direction: Direction,
  base: readonly LayoutItem[] = items,
): readonly LayoutItem[] {
  const item = items[indexOf(items, id)];
  if (!item || item.hidden) return items;
  const step = keyboardStep(catalog);
  const dx = direction === 'left' ? -step.columns : direction === 'right' ? step.columns : 0;
  const dy = direction === 'up' ? -step.rows : direction === 'down' ? step.rows : 0;
  return moveItem(catalog, base, id, { x: item.x + dx, y: item.y + dy }, items);
}

/** Un paso de teclado de tamaño: derecha e izquierda cambian el ancho; abajo y arriba, el alto. */
export function stepSize(
  catalog: ViewCatalog,
  items: readonly LayoutItem[],
  id: string,
  direction: Direction,
  base: readonly LayoutItem[] = items,
): readonly LayoutItem[] {
  const item = items[indexOf(items, id)];
  if (!item) return items;
  const step = keyboardStep(catalog);
  const sign = direction === 'right' || direction === 'down' ? 1 : -1;
  const horizontal = direction === 'left' || direction === 'right';
  return resizeItem(
    catalog,
    base,
    id,
    {
      w: item.w + (horizontal ? sign * step.columns : 0),
      h: item.h + (horizontal ? 0 : sign * step.rows),
    },
    items,
  );
}

/**
 * Oculta o muestra un bloque. Al ocultarlo, su lugar queda libre y nadie se mueve. Al volver,
 * reaparece donde estaba y los que pisa bajan.
 */
export function setHidden(
  items: readonly LayoutItem[],
  id: string,
  hidden: boolean,
): readonly LayoutItem[] {
  const index = indexOf(items, id);
  const item = items[index];
  if (!item || item.hidden === hidden) return items;
  return hidden
    ? replaceAt(items, index, { ...item, hidden })
    : relocateOrFill(items, index, { ...item, hidden });
}

/**
 * Cambia cómo se muestra un bloque; ignora presentaciones que el bloque no ofrece. Si la nueva
 * necesita más lugar (p. ej. una torta), el bloque crece hasta su mínimo y los que pisa bajan.
 */
export function setPresentation(
  catalog: ViewCatalog,
  items: readonly LayoutItem[],
  id: string,
  presentation: string,
): readonly LayoutItem[] {
  const index = indexOf(items, id);
  const item = items[index];
  const widget = widgetOf(catalog, id);
  if (!item || !widget?.presentations.includes(presentation) || item.presentation === presentation)
    return items;
  const min = widgetMinSize(widget, presentation);
  const w = Math.max(item.w, min.w);
  const grown = {
    ...item,
    presentation,
    w,
    h: Math.max(item.h, min.h),
    x: Math.min(item.x, catalog.columns - w),
  };
  return item.hidden ? replaceAt(items, index, grown) : relocateOrFill(items, index, grown);
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
  const widget = widgetOf(catalog, id);
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
  // Se escalan los bordes, no el ancho: dos bloques contiguos siguen contiguos (49+47 → 25+23).
  const scaled = items.map((item) => {
    const x = clamp(Math.round(item.x * ratio), 0, toColumns - 1);
    const right = clamp(Math.round((item.x + item.w) * ratio), x + 1, toColumns);
    return { ...item, x, w: right - x };
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
