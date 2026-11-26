export type SortValue = string | number | Date | null | undefined;
export type DataColumnType = 'text' | 'number' | 'date';

const collator = new Intl.Collator('es-AR', { numeric: true, sensitivity: 'base' });

/** El valor tal como se compara; null si está vacío o no es válido (NaN, fecha inválida). */
function sortKey(v: SortValue, type: DataColumnType): string | number | null {
  if (v === null || v === undefined || v === '') return null;
  if (type === 'text') return String(v);
  const n = type === 'date' ? new Date(v).getTime() : Number(v);
  // Un NaN rompería la transitividad del sort: cuenta como vacío.
  return Number.isNaN(n) ? null : n;
}

export const isEmpty = (v: SortValue, type: DataColumnType = 'text') => sortKey(v, type) === null;

/** Compara según el tipo de dato. Los vacíos van siempre al final. */
export function compareValues(a: SortValue, b: SortValue, type: DataColumnType = 'text'): number {
  const [x, y] = [sortKey(a, type), sortKey(b, type)];
  if (x === null || y === null) return Number(x === null) - Number(y === null);
  return typeof x === 'number' && typeof y === 'number'
    ? x - y
    : collator.compare(String(x), String(y));
}
