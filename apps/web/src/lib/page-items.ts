export const PAGE_SIZES = [3, 5, 10, 20, 50] as const;

/**
 * Páginas a mostrar: primera … anterior, actual, siguiente … última. Solo aparece lo que existe y
 * "…" solo si se saltea alguna página (en la 1: 1, 2 … última; en la 3: 1, 2, 3, 4 … última).
 */
export function pageItems(current: number, total: number): (number | 'gap')[] {
  const items: (number | 'gap')[] = [];
  if (current > 2) items.push(1);
  if (current > 3) items.push('gap');
  if (current > 1) items.push(current - 1);
  items.push(current);
  if (current < total) items.push(current + 1);
  if (current < total - 2) items.push('gap');
  if (current < total - 1) items.push(total);
  return items;
}
