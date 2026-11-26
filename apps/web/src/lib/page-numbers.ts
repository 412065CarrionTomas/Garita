/**
 * Páginas a mostrar: primera, anterior, actual, siguiente y última. `null` marca un salto;
 * si el salto tapa una sola página, se muestra esa página en lugar de "…".
 */
export function pageNumbers(current: number, total: number): (number | null)[] {
  const last = Math.max(1, total);
  const shown = [...new Set([1, current - 1, current, current + 1, last])]
    .filter((n) => n >= 1 && n <= last)
    .sort((a, b) => a - b);
  const pages: (number | null)[] = [];
  for (const n of shown) {
    const previous = pages.at(-1);
    if (typeof previous === 'number' && n - previous === 2) pages.push(previous + 1);
    else if (typeof previous === 'number' && n - previous > 2) pages.push(null);
    pages.push(n);
  }
  return pages;
}
