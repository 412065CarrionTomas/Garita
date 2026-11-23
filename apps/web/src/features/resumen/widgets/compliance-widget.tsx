import { useId } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Rectangle,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from 'recharts';
import { adminSummaryCatalog, type ComplianceReport } from '@garita/shared';
import { space } from '@garita/tokens';
import { Stamp } from '@/components/stamp';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  FailurePattern,
  axisProps,
  barProps,
  chartColors,
  gridProps,
  tooltipProps,
} from '@/features/reportes/charts/chart-theme';
import { COMPLIANCE_THRESHOLD } from '@/features/reportes/charts/compliance-tone';
import { cn } from '@/lib/utils';
import { useComplianceReport } from '../queries';
import { WidgetEmpty, WidgetFrame, WidgetStatus } from '../widget-frame';
import type { WidgetProps } from './widget-props';

const percent = (value: number) =>
  `${value.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`;
const dayLabel = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

interface DayPoint {
  id: string;
  name: string;
  value: number | null;
  evaluated: number;
  low: boolean;
}

function days(report: ComplianceReport): DayPoint[] {
  return report.daily.map((day) => ({
    id: day.id,
    name: dayLabel(day.id),
    value: day.totals.percentage === null ? null : Math.round(day.totals.percentage * 10) / 10,
    evaluated: day.totals.evaluated,
    low: day.totals.percentage !== null && day.totals.percentage < COMPLIANCE_THRESHOLD,
  }));
}

/** El eje arranca cerca del peor día (en múltiplos de 10) para que se vea la variación. */
function axisFloor(points: DayPoint[]): number {
  const values = points.flatMap((point) => (point.value === null ? [] : [point.value]));
  if (values.length === 0) return 0;
  return Math.max(0, Math.min(80, Math.floor((Math.min(...values) - 5) / 10) * 10));
}

function DailyChart({ points, presentation }: { points: DayPoint[]; presentation: string }) {
  const patternId = `compliance-failure-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const floor = axisFloor(points);
  const margin = { top: space[2], right: space[4], bottom: space[1], left: 0 };
  const common = (
    <>
      <defs>
        <FailurePattern id={patternId} />
      </defs>
      <CartesianGrid {...gridProps} />
      <XAxis dataKey="name" {...axisProps} minTickGap={16} />
      <YAxis domain={[floor, 100]} {...axisProps} width={36} />
      <Tooltip {...tooltipProps} />
      <ReferenceLine
        y={COMPLIANCE_THRESHOLD}
        stroke={chartColors.failure}
        strokeDasharray="5 4"
        strokeWidth={1.5}
      />
    </>
  );
  return (
    <figure className="m-0 space-y-1">
      <div aria-hidden="true" className="h-56 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          {presentation === 'bars' ? (
            <BarChart data={points} margin={margin} accessibilityLayer={false}>
              {common}
              <Bar
                dataKey="value"
                name="Cumplimiento (%)"
                {...barProps}
                shape={(bar: BarShapeProps) => (
                  <Rectangle
                    {...bar}
                    fill={points[bar.index]?.low ? `url(#${patternId})` : chartColors.ink}
                  />
                )}
              />
            </BarChart>
          ) : (
            <LineChart data={points} margin={margin} accessibilityLayer={false}>
              {common}
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
          )}
        </ResponsiveContainer>
      </div>
      <figcaption className="t-label text-muted-foreground">
        Eje desde {floor} %. Línea roja punteada: umbral de {COMPLIANCE_THRESHOLD} %.
      </figcaption>
    </figure>
  );
}

function DailyTable({ points, visible }: { points: DayPoint[]; visible: boolean }) {
  return (
    <Table className={cn(!visible && 'sr-only')}>
      <caption className="sr-only">Cumplimiento por día</caption>
      <TableHeader>
        <TableRow>
          <TableHead>Día</TableHead>
          <TableHead className="text-right">Ventanas</TableHead>
          <TableHead>Cumplimiento</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {points.map((point) => (
          <TableRow key={point.id}>
            <TableCell className="t-numeral">{point.name}</TableCell>
            <TableCell className="t-numeral text-right">{point.evaluated}</TableCell>
            <TableCell>
              {point.value === null ? (
                <span className="text-muted-foreground">Sin datos</span>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="t-numeral">{percent(point.value)}</span>
                  {point.low && <Stamp variant="fail">Bajo umbral</Stamp>}
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Barra apilada de rondas por estado: tinta a tiempo, ámbar con demora, rojo las fallas. */
function StateBar({ totals }: { totals: ComplianceReport['totals'] }) {
  const onTime = totals.complete - totals.complete_late;
  const parts = [
    { key: 'on-time', label: 'A tiempo', value: onTime, className: 'bg-foreground' },
    { key: 'late', label: 'Con demora', value: totals.complete_late, className: 'bg-warning' },
    {
      key: 'incomplete',
      label: 'Incompletas',
      value: totals.incomplete,
      className: 'bg-card',
      hatch: true,
    },
    { key: 'not-done', label: 'No realizadas', value: totals.not_done, className: 'bg-danger' },
  ];
  if (totals.evaluated === 0) return null;
  return (
    <div className="space-y-2">
      <p className="t-label text-muted-foreground">Rondas por estado</p>
      <div aria-hidden="true" className="flex h-6 border-[1.5px] border-foreground">
        {parts.map((part) =>
          part.value ? (
            <span
              key={part.key}
              className={part.className}
              style={{
                width: `${(part.value / totals.evaluated) * 100}%`,
                ...(part.hatch && {
                  background:
                    'repeating-linear-gradient(45deg, var(--danger) 0 3px, transparent 3px 7px)',
                }),
              }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {parts.map((part) => (
          <li key={part.key}>
            {part.label} <strong className="t-numeral">{part.value}</strong>
          </li>
        ))}
        <li className="text-muted-foreground">
          Fuera del porcentaje: {totals.in_review} en revisión · {totals.pending_sync} sin
          sincronizar
        </li>
      </ul>
    </div>
  );
}

export function ComplianceWidget({ item }: WidgetProps) {
  const { period } = adminSummaryCatalog.widgets.compliance.settings.parse(item.settings);
  const report = useComplianceReport(period);
  const title = `Cumplimiento · ${period === '7d' ? '7' : '30'} días`;
  const link = { to: '/cumplimiento', label: 'Ver cumplimiento' };
  if (!report.data)
    return (
      <WidgetFrame title={title} link={link}>
        <WidgetStatus query={report} label="el cumplimiento" />
      </WidgetFrame>
    );
  const { totals } = report.data;
  const points = days(report.data);
  const lowDays = points.filter((point) => point.low).length;
  return (
    <WidgetFrame title={title} link={link}>
      {totals.evaluated === 0 ? (
        <WidgetEmpty>Todavía no hay rondas evaluadas en el período.</WidgetEmpty>
      ) : (
        <div className="space-y-5 p-5">
          <p className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <span className="t-numeral text-3xl">
              {totals.percentage === null ? 'Sin datos' : percent(totals.percentage)}
            </span>
            <span>
              de ventanas cumplidas · <strong className="t-numeral">{totals.complete}</strong> de{' '}
              <span className="t-numeral">{totals.evaluated}</span> evaluadas
            </span>
            {totals.complete_late > 0 && (
              <Stamp variant="late">{totals.complete_late} con demora</Stamp>
            )}
            {lowDays > 0 && (
              <Stamp variant="fail">
                {lowDays} {lowDays === 1 ? 'día' : 'días'} bajo {COMPLIANCE_THRESHOLD} %
              </Stamp>
            )}
          </p>
          {item.presentation !== 'table' && (
            <DailyChart points={points} presentation={item.presentation} />
          )}
          <DailyTable points={points} visible={item.presentation === 'table'} />
          <StateBar totals={totals} />
        </div>
      )}
    </WidgetFrame>
  );
}
