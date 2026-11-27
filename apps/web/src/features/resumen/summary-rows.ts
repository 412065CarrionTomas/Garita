import { adminSummaryCatalog } from '@garita/shared';
import type { ChartTone } from '@/features/reportes/charts/compliance-tone';
import { shiftLabels, shiftTones, type ShiftRow } from '@/features/supervision/contracts';

/*
 * Transformaciones puras de los datos de la API a lo que dibujan los bloques del resumen.
 * Separadas de los componentes para testearlas sin renderizar.
 */

export interface CategoryRow {
  id: string;
  name: string;
  value: number;
  /** Solo las excepciones llevan tono; lo normal va en tinta. */
  tone?: ChartTone;
}
export type CategoryPresentation = 'bars' | 'pie' | 'table';

/** Presentación del diseño guardado; el catálogo ya la validó, esto solo la estrecha. */
export function categoryPresentation(value: string): CategoryPresentation {
  return value === 'pie' || value === 'table' ? value : 'bars';
}

/** Título del bloque según el catálogo, o su id si el catálogo ya no lo tiene. */
export function widgetTitle(id: string): string {
  const widgets: Readonly<Record<string, { title: string } | undefined>> =
    adminSummaryCatalog.widgets;
  return widgets[id]?.title ?? id;
}

const SHIFT_TONE: Partial<Record<(typeof shiftTones)[keyof typeof shiftTones], ChartTone>> = {
  danger: 'failure',
  warning: 'delay',
};

/** Una fila por estado presente; las etiquetas iguales (p. ej. "Sin vigilador") se suman. */
export function shiftStatusRows(shifts: readonly ShiftRow[]): CategoryRow[] {
  const rows = new Map<string, CategoryRow>();
  for (const shift of shifts) {
    const name = shiftLabels[shift.status];
    const row = rows.get(name);
    if (row) row.value += 1;
    else
      rows.set(name, {
        id: shift.status,
        name,
        value: 1,
        tone: SHIFT_TONE[shiftTones[shift.status]],
      });
  }
  return [...rows.values()];
}

/** Lo mínimo para ordenar por cumplimiento: nombre y porcentaje (null si no hubo ventanas). */
interface Ranked {
  name: string;
  totals: { percentage: number | null };
}

/** Peor cumplimiento primero (los sin datos al final) o por nombre; luego se corta al límite. */
export function sortByCompliance<T extends Ranked>(
  rows: readonly T[],
  sort: 'worst' | 'name',
  limit: '5' | '10' | 'all',
): T[] {
  const sorted = [...rows].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'es');
    const pa = a.totals.percentage ?? Number.POSITIVE_INFINITY;
    const pb = b.totals.percentage ?? Number.POSITIVE_INFINITY;
    return pa - pb || a.name.localeCompare(b.name, 'es');
  });
  return limit === 'all' ? sorted : sorted.slice(0, Number(limit));
}
