/*
 * Motor de listas reordenables: funciones puras sobre listas de ids, sin React ni DOM. Sirve a
 * los fijados (que se guardan) y al orden de sesión del resto (que no se guarda). Como el motor
 * de la grilla, devuelven la MISMA referencia cuando la acción no cambia nada.
 */

export type ReorderAction = 'top' | 'up' | 'down' | 'bottom';

/** Mueve `id` a la posición `index` (se recorta al rango de la lista). */
export function moveIdTo(ids: readonly string[], id: string, index: number): readonly string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const to = Math.min(Math.max(Math.trunc(index), 0), ids.length - 1);
  if (to === from) return ids;
  const next = ids.filter((other) => other !== id);
  next.splice(to, 0, id);
  return next;
}

/** Arriba de todo, uno arriba, uno abajo o al final. */
export function moveId(
  ids: readonly string[],
  id: string,
  action: ReorderAction,
): readonly string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const to =
    action === 'top' ? 0 : action === 'bottom' ? ids.length - 1 : from + (action === 'up' ? -1 : 1);
  return moveIdTo(ids, id, to);
}

/** Acciones que tienen efecto para `id`: el menú no ofrece las que no harían nada. */
export function availableActions(ids: readonly string[], id: string): ReorderAction[] {
  const index = ids.indexOf(id);
  if (index === -1) return [];
  const last = ids.length - 1;
  return [
    ...(index > 0 ? (['top', 'up'] as const) : []),
    ...(index < last ? (['down', 'bottom'] as const) : []),
  ];
}

/** Fija `id` arriba de todo o al final de los fijados; si ya estaba, solo lo mueve. */
export function pin(
  pinned: readonly string[],
  id: string,
  where: 'top' | 'bottom' = 'top',
  max = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (pinned.includes(id)) return moveId(pinned, id, where);
  if (pinned.length >= max) return pinned;
  return where === 'top' ? [id, ...pinned] : [...pinned, id];
}

export function unpin(pinned: readonly string[], id: string): readonly string[] {
  return pinned.includes(id) ? pinned.filter((other) => other !== id) : pinned;
}

/**
 * Separa una lista en fijados (en el orden de `pinned`) y el resto (en su orden). Los fijados que
 * no están en la lista se omiten: pueden pertenecer a otra página o haberse desactivado.
 */
export function partitionPinned<T>(
  items: readonly T[],
  pinned: readonly string[],
  getId: (item: T) => string,
): { pinned: T[]; rest: T[] } {
  const byId = new Map(items.map((item) => [getId(item), item]));
  const pinnedSet = new Set(pinned);
  return {
    pinned: pinned.flatMap((id) => byId.get(id) ?? []),
    rest: items.filter((item) => !pinnedSet.has(getId(item))),
  };
}

/**
 * Aplica un orden de sesión a los datos actuales: primero los ids conocidos en ese orden y
 * después los que llegaron más tarde, en el orden de los datos. Los ids del orden que ya no
 * están en los datos se ignoran.
 */
export function applyOrder<T>(
  items: readonly T[],
  order: readonly string[],
  getId: (item: T) => string,
): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, index, rank: rank.get(getId(item)) }))
    .sort((a, b) => {
      if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank;
      if (a.rank !== undefined) return -1;
      if (b.rank !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

/**
 * Vuelca el orden nuevo de los elementos visibles en la lista completa, sin tocar el lugar de
 * los que no se ven (p. ej. fijados que no están en esta página o en este período): guardar
 * solo los visibles los borraría sin aviso. `visibleNext` debe ser una permutación de los
 * visibles de `full`.
 */
export function mergeVisibleOrder(
  full: readonly string[],
  visibleNext: readonly string[],
): readonly string[] {
  const visible = new Set(visibleNext);
  let cursor = 0;
  const merged = full.map((id) => (visible.has(id) ? (visibleNext[cursor++] ?? id) : id));
  return merged.every((id, index) => id === full[index]) ? full : merged;
}
