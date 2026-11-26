import type { CSSProperties } from 'react';
import { FAILURE_HATCH } from './chart-theme';
import { niceMax, type ChartTone } from './compliance-tone';
import { cn } from '@/lib/utils';

export interface BarListRow {
  id: string;
  name: string;
  value: number | null;
  tone?: ChartTone;
}

const toneClass: Record<ChartTone, string> = {
  ink: 'bg-foreground',
  delay: 'bg-warning',
  failure: 'border-[1.5px] border-danger',
  muted: 'bg-muted-foreground',
};
// Falla: trama diagonal, así se distingue sin depender del color.
const toneStyle: Partial<Record<ChartTone, CSSProperties>> = {
  failure: { background: FAILURE_HATCH },
};

/**
 * Barras horizontales en HTML: la columna de nombres mide lo que el nombre más largo (y los muy
 * largos van en dos renglones), las barras ocupan el resto y el valor aparece al pasar el mouse.
 * Es visual (`aria-hidden`): la tabla equivalente del gráfico es la versión accesible.
 */
export function BarList({
  rows,
  percentage,
  format,
  onSelect,
  fill = false,
}: {
  rows: BarListRow[];
  percentage: boolean;
  format: (value: number | null) => string;
  onSelect?: (id: string) => void;
  /** Estira las filas para ocupar el alto disponible (cuando el gráfico vecino es más alto). */
  fill?: boolean;
}) {
  const top = percentage ? 100 : niceMax(Math.max(0, ...rows.map((row) => row.value ?? 0)));
  const ticks = [0, 1, 2, 3, 4].map((step) => (top * step) / 4);
  const Row = onSelect ? 'button' : 'div';
  return (
    <div
      aria-hidden="true"
      className={cn(
        'grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-3',
        fill && 'h-full content-between',
      )}
    >
      {rows.map((row) => {
        const width = row.value === null ? 0 : Math.min(100, (row.value / top) * 100);
        const tone = row.tone ?? 'ink';
        return (
          <Row
            key={row.id}
            {...(onSelect && {
              type: 'button' as const,
              tabIndex: -1,
              onClick: () => {
                onSelect(row.id);
              },
            })}
            className={cn(
              'group col-span-2 grid min-h-9 grid-cols-subgrid items-center text-left',
              onSelect && 'cursor-pointer hover:bg-muted',
            )}
          >
            <span className="line-clamp-2 max-w-52 py-1 text-right text-base leading-tight font-medium text-balance text-foreground">
              {row.name}
            </span>
            <span className="relative h-5">
              {/* Guías del eje detrás de la barra. */}
              {ticks.slice(1).map((tick) => (
                <span
                  key={tick}
                  className="absolute inset-y-0 w-px bg-border"
                  style={{ left: `${(tick / top) * 100}%` }}
                />
              ))}
              {/* En 0 no se dibuja: el borde de la falla quedaría como una raya roja sobre el cero. */}
              {width > 0 && (
                <span
                  className={cn('absolute inset-y-0 left-0', toneClass[tone])}
                  style={{ width: `${width}%`, ...toneStyle[tone] }}
                />
              )}
              <span
                className="pointer-events-none absolute bottom-full z-10 mb-1 hidden border-[1.5px] border-input bg-card px-2 py-0.5 text-sm font-semibold whitespace-nowrap tabular-nums group-hover:block"
                style={{ left: `${width}%`, translate: width > 50 ? '-100% 0' : undefined }}
              >
                {row.name}: {format(row.value)}
              </span>
            </span>
          </Row>
        );
      })}
      <span />
      <span className="relative h-5 text-xs text-muted-foreground tabular-nums">
        {ticks.map((tick, index) => (
          <span
            key={tick}
            className="absolute top-1"
            style={{
              left: `${(tick / top) * 100}%`,
              translate: index === 0 ? undefined : index === 4 ? '-100% 0' : '-50% 0',
            }}
          >
            {tick.toLocaleString('es-AR')}
          </span>
        ))}
      </span>
    </div>
  );
}
