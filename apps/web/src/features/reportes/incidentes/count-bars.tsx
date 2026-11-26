import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface CountRow {
  id: string;
  name: string;
  value: number;
}

/**
 * Barras horizontales con el número a la vista. Cada fila es un botón que abre el detalle de ese
 * segmento; el texto del botón dice nombre y cantidad, así que no hace falta tabla aparte.
 */
export function CountBars({
  title,
  rows,
  onSelect,
  empty = 'Sin datos en el período.',
  barClassName,
  action,
}: {
  title: string;
  rows: CountRow[];
  onSelect: (id: string, name: string) => void;
  empty?: string;
  barClassName?: (row: CountRow) => string | undefined;
  action?: ReactNode;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <section className="space-y-3 border-[1.5px] border-input bg-card p-4">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        {action}
      </header>
      {total === 0 ? (
        <p className="text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                disabled={row.value === 0}
                onClick={() => {
                  onSelect(row.id, row.name);
                }}
                aria-label={`${row.name}: ${String(row.value)}. Ver detalle`}
                className="grid w-full grid-cols-[minmax(0,11rem)_minmax(0,1fr)_3rem] items-center gap-3 rounded-sm px-1 py-1 text-left hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span className="truncate">{row.name}</span>
                <span className="relative h-4 bg-muted" aria-hidden="true">
                  <span
                    className={cn('absolute inset-y-0 left-0 bg-foreground', barClassName?.(row))}
                    style={{ width: `${String((row.value / max) * 100)}%` }}
                  />
                </span>
                <span className="text-right font-semibold tabular-nums">{row.value}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
