import { useId } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { space, fontSize } from '@garita/tokens';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
}
export function ComplianceChart({
  title,
  rows,
  percentage = false,
  evolution = false,
  onSelect,
}: {
  title: string;
  rows: ComplianceChartRow[];
  percentage?: boolean;
  evolution?: boolean;
  onSelect?: (id: string) => void;
}) {
  const titleId = useId();
  const data = rows.map((row) => ({
    ...row,
    value: row.value === null ? null : Math.round(row.value * 100) / 100,
  }));
  const series = evolution ? (
    <Line
      dataKey="value"
      name="Cumplimiento (%)"
      stroke="var(--info)"
      connectNulls={false}
      isAnimationActive={false}
    />
  ) : (
    <Bar
      dataKey="value"
      name={percentage ? 'Cumplimiento (%)' : 'Ventanas'}
      fill="var(--info)"
      isAnimationActive={false}
    />
  );
  const Chart = evolution ? LineChart : BarChart;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id={titleId}>{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <p>Sin datos para este período.</p>
        ) : (
          <div aria-hidden="true" className="h-64 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <Chart
                data={data}
                margin={{ top: space[2], right: space[4], bottom: space[2], left: space[1] }}
                accessibilityLayer={false}
                onClick={(state) => {
                  if (state.activeTooltipIndex === undefined || state.activeTooltipIndex === null)
                    return;
                  const row = data[Number(state.activeTooltipIndex)];
                  if (row) onSelect?.(row.id);
                }}
              >
                <CartesianGrid stroke="var(--border)" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: 'var(--muted-foreground)', fontSize: fontSize.xs.size }}
                />
                <YAxis
                  domain={percentage ? [0, 100] : [0, 'auto']}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: fontSize.xs.size }}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--card)',
                    color: 'var(--card-foreground)',
                    borderColor: 'var(--border)',
                  }}
                />
                {series}
              </Chart>
            </ResponsiveContainer>
          </div>
        )}
        <Table aria-labelledby={titleId}>
          <TableHeader>
            <TableRow>
              <TableHead>Indicador</TableHead>
              <TableHead>{percentage ? 'Cumplimiento' : 'Ventanas'}</TableHead>
              {onSelect && <TableHead>Detalle</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {row.name}
                  {row.description && (
                    <span className="block text-sm text-muted-foreground">{row.description}</span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.value === null
                    ? 'Sin datos'
                    : `${row.value.toLocaleString('es-AR')}${percentage ? ' %' : ''}`}
                </TableCell>
                {onSelect && (
                  <TableCell>
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
      </CardContent>
    </Card>
  );
}
