import { useId } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { space } from '@garita/tokens';
import { axisProps, barProps, chartColors, gridProps, tooltipProps } from './chart-theme';
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

export function CountChart({
  title,
  rows,
  onSelect,
}: {
  title: string;
  rows: { id: string; name: string; value: number }[];
  onSelect: (id: string) => void;
}) {
  const titleId = useId();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id={titleId}>{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 && <p>No hay datos en el período.</p>}
        <div aria-hidden="true" className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              margin={{ top: space[2], right: space[4], bottom: space[2], left: space[1] }}
              accessibilityLayer={false}
              onClick={(state) => {
                const row =
                  state.activeTooltipIndex == null
                    ? undefined
                    : rows[Number(state.activeTooltipIndex)];
                if (row) onSelect(row.id);
              }}
            >
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="name" {...axisProps} />
              <YAxis allowDecimals={false} {...axisProps} />
              <Tooltip {...tooltipProps} />
              <Bar dataKey="value" name="Cantidad" fill={chartColors.ink} {...barProps} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Table aria-labelledby={titleId}>
          <TableHeader>
            <TableRow>
              <TableHead>Indicador</TableHead>
              <TableHead>Cantidad</TableHead>
              <TableHead>Detalle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.name}</TableCell>
                <TableCell className="tabular-nums">{row.value.toLocaleString('es-AR')}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Ver detalle: ${row.name}`}
                    onClick={() => {
                      onSelect(row.id);
                    }}
                  >
                    Ver detalle
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
