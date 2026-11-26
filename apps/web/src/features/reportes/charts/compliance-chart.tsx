import { useId } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { space } from '@garita/tokens';
import { axisProps, chartColors, gridProps, tooltipProps } from './chart-theme';
import { BarList } from './bar-list';
import { COMPLIANCE_THRESHOLD, type ChartTone } from './compliance-tone';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface ComplianceChartRow {
  id: string;
  name: string;
  value: number | null;
  description?: string;
  tone?: ChartTone;
}

const dayLabel = (name: string) => {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(name);
  return match ? `${match[2]}/${match[1]}` : name;
};

/**
 * Un gráfico con su tabla equivalente. Las categorías van en barras horizontales (los nombres se
 * leen completos); la evolución, en línea con el umbral marcado. La tabla queda plegada en
 * "Ver datos" y es el camino por teclado para abrir las ventanas de cada fila.
 */
export function ComplianceChart({
  title,
  rows,
  percentage = false,
  evolution = false,
  onSelect,
  fill = false,
  className,
}: {
  title: string;
  rows: ComplianceChartRow[];
  percentage?: boolean;
  evolution?: boolean;
  onSelect?: (id: string) => void;
  /** Barras estiradas al alto de la celda (cuando el gráfico vecino es más alto). */
  fill?: boolean;
  className?: string;
}) {
  const titleId = useId();
  const data = rows.map((row) => ({
    ...row,
    label: evolution ? dayLabel(row.name) : row.name,
    value: row.value === null ? null : Math.round(row.value * 100) / 100,
  }));
  const domain: [number, number] = [0, 100];
  const format = (value: number | null) =>
    value === null ? 'Sin datos' : `${value.toLocaleString('es-AR')}${percentage ? ' %' : ''}`;
  const select = (index: number | string | null | undefined) => {
    if (index === undefined || index === null) return;
    const row = data[Number(index)];
    if (row) onSelect?.(row.id);
  };
  const lineChart = (
    <LineChart
      data={data}
      margin={{ top: space[2], right: space[4], bottom: 0, left: 0 }}
      accessibilityLayer={false}
      onClick={(state) => {
        select(state.activeTooltipIndex);
      }}
    >
      <CartesianGrid {...gridProps} />
      <XAxis dataKey="label" {...axisProps} minTickGap={16} />
      <YAxis domain={domain} {...axisProps} width={32} />
      <Tooltip {...tooltipProps} />
      <ReferenceLine
        y={COMPLIANCE_THRESHOLD}
        stroke={chartColors.failure}
        strokeDasharray="5 4"
        strokeWidth={1.5}
      />
      <Line
        dataKey="value"
        name="Cumplimiento (%)"
        type="linear"
        stroke={chartColors.ink}
        strokeWidth={2}
        dot={{ r: 2.5, fill: chartColors.ink, stroke: chartColors.ink }}
        connectNulls={false}
        isAnimationActive={false}
      />
    </LineChart>
  );
  return (
    <section aria-labelledby={titleId} className={cn('flex min-w-0 flex-col gap-2 p-4', className)}>
      <h3 id={titleId} className="t-label text-muted-foreground">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">Sin datos para este período.</p>
      ) : evolution ? (
        <div aria-hidden="true" className={cn('h-52 w-full min-w-0', onSelect && 'cursor-pointer')}>
          <ResponsiveContainer width="100%" height="100%">
            {lineChart}
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <BarList
            rows={data}
            percentage={percentage}
            format={format}
            onSelect={onSelect}
            fill={fill}
          />
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-semibold underline-offset-4 hover:underline">
          Ver datos
        </summary>
        <Table aria-labelledby={titleId} containerClassName="mt-2 max-h-64 overflow-auto">
          <TableHeader className="sticky top-0 z-10">
            <TableRow>
              <TableHead className="px-3">Indicador</TableHead>
              <TableHead className="px-3 text-right">
                {percentage ? 'Cumplimiento' : 'Ventanas'}
              </TableHead>
              {onSelect && (
                <TableHead className="px-3">
                  <span className="sr-only">Detalle</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="h-9 px-3 py-1">
                  {row.name}
                  {row.description && (
                    <span className="block text-muted-foreground">{row.description}</span>
                  )}
                </TableCell>
                <TableCell className="h-9 px-3 py-1 text-right tabular-nums">
                  {format(row.value)}
                </TableCell>
                {onSelect && (
                  <TableCell className="h-9 px-3 py-1 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        onSelect(row.id);
                      }}
                      aria-label={`Ver ventanas: ${row.name}`}
                    >
                      Ver ventanas
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </section>
  );
}
