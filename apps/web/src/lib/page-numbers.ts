/**
 * Primera, anterior, actual, siguiente y última, sin repetir; `null` marca un salto de páginas.
 * En la página 1 de 8 queda `1 2 … 8`; en la 5, `1 … 4 5 6 … 8`.
 */
export function pageNumbers(current: number, total: number): (number | null)[] {
  const pages: (number | null)[] = [];
  for (let n = 1; n <= Math.max(1, total); n++) {
    if (n === 1 || n === total || Math.abs(n - current) <= 1) pages.push(n);
    else if (pages.at(-1) !== null) pages.push(null);
  }
  return pages;
}
