export type SortValue = string | number | Date | null | undefined;
export type DataColumnType = 'text' | 'number' | 'date';

const collator = new Intl.Collator('es-AR', { numeric: true, sensitivity: 'base' });

export const isEmpty = (v: SortValue) => v === null || v === undefined || v === '';

/** Compara según el tipo de dato. Los vacíos van siempre al final. */
export function compareValues(a: SortValue, b: SortValue, type: DataColumnType = 'text'): number {
  if (isEmpty(a) || isEmpty(b)) return Number(isEmpty(a)) - Number(isEmpty(b));
  if (type === 'number') return Number(a) - Number(b);
  if (type === 'date') return new Date(a).getTime() - new Date(b).getTime();
  return collator.compare(String(a), String(b));
}
