import { useId } from 'react';
import { Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  FAILURE_HATCH,
  FailurePattern,
  chartColors,
  tooltipProps,
} from '@/features/reportes/charts/chart-theme';
import { toneFill } from '@/features/reportes/charts/compliance-tone';
import { cn } from '@/lib/utils';
import type { CategoryPresentation, CategoryRow } from './summary-rows';
import { WidgetEmpty } from './widget-frame';

// Lo normal se distingue por intensidad de tinta, no por tono (regla del sistema Foja).
const INK_STEPS = [1, 0.72, 0.5, 0.34, 0.22, 0.14];

function percent(value: number, total: number) {
  return total === 0 ? 0 : Math.round((value / total) * 100);
}

/**
 * Cantidades por categoría como barras, torta o tabla. El gráfico es decorativo para el lector de
 * pantalla: siempre va acompañado de su tabla (visible en la presentación "tabla").
 */
export function CategoryChart({
  rows,
  presentation,
  caption,
  valueLabel = 'Cantidad',
}: {
  rows: readonly CategoryRow[];
  presentation: CategoryPresentation;
  caption: string;
  valueLabel?: string;
}) {
  // useId trae ":"; en `url(#…)` de SVG solo se usan caracteres seguros.
  const patternId = `category-failure-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (rows.length === 0 || total === 0) return <WidgetEmpty>Sin datos en el período.</WidgetEmpty>;
  const max = Math.max(...rows.map((row) => row.value));
  const table = (
    <Table className={cn(presentation !== 'table' && 'sr-only')}>
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        <TableRow>
          <TableHead>Categoría</TableHead>
          <TableHead className="text-right">{valueLabel}</TableHead>
          <TableHead className="text-right">Proporción</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.name}</TableCell>
            <TableCell className="t-numeral text-right">{row.value}</TableCell>
            <TableCell className="text-right tabular-nums">{percent(row.value, total)} %</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
  if (presentation === 'table') return table;
  const fill = (row: CategoryRow) =>
    row.tone === 'failure' ? `url(#${patternId})` : row.tone ? toneFill[row.tone] : chartColors.ink;
  const opacity = (row: CategoryRow, index: number) =>
    row.tone ? 1 : (INK_STEPS[index % INK_STEPS.length] ?? 1);
  return (
    <div className="p-5">
      {presentation === 'bars' ? (
        <ul aria-hidden="true" className="space-y-2.5">
          {rows.map((row) => (
            <li
              key={row.id}
              className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-3 text-sm"
            >
              <span className="truncate">{row.name}</span>
              <span className="h-3">
                <span
                  className={cn(
                    'block h-full',
                    row.tone === 'failure' ? 'border-[1.5px] border-danger' : 'bg-foreground',
                    row.tone === 'delay' && 'bg-warning',
                  )}
                  style={{
                    width: `${(row.value / max) * 100}%`,
                    ...(row.tone === 'failure' && {
                      background: FAILURE_HATCH,
                    }),
                  }}
                />
              </span>
              <span className="t-numeral text-right">{row.value}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div aria-hidden="true" className="flex flex-wrap items-center gap-5">
          <div className="aspect-square w-40 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart accessibilityLayer={false}>
                <defs>
                  <FailurePattern id={patternId} />
                </defs>
                <Pie
                  // El color de cada porción va en el dato (Cell está obsoleto en Recharts 3).
                  data={rows.map((row, index) => ({
                    ...row,
                    fill: fill(row),
                    fillOpacity: opacity(row, index),
                  }))}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="45%"
                  stroke={chartColors.paper}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Tooltip {...tooltipProps} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
            {rows.map((row, index) => (
              <li key={row.id} className="flex items-center gap-2">
                <span
                  className={cn(
                    'size-3 shrink-0 border-[1.5px]',
                    row.tone === 'failure' ? 'border-danger' : 'border-foreground',
                  )}
                  style={{
                    background: row.tone === 'failure' ? FAILURE_HATCH : fill(row),
                    opacity: row.tone === 'failure' ? undefined : opacity(row, index),
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <span className="t-numeral">{row.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {table}
    </div>
  );
}
