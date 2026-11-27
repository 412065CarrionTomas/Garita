import { createElement, type ReactNode } from 'react';
import { fontSize } from '@garita/tokens';

/*
 * Estilo común de los gráficos de Recharts (sistema Foja): marcas en tinta, ámbar para demoras,
 * rojo con trama diagonal para fallas. Barras de borde recto; sin degradados, sombras ni esquinas
 * redondeadas. Todo sale de variables CSS, así que sigue al tema claro/oscuro.
 */

export const chartColors = {
  ink: 'var(--foreground)',
  delay: 'var(--warning)',
  failure: 'var(--danger)',
  border: 'var(--border)',
  muted: 'var(--muted-foreground)',
  paper: 'var(--card)',
} as const;

export const chartFont = { family: 'var(--font-cond)', size: fontSize.xs.size } as const;

const tick = { fill: chartColors.muted, fontFamily: chartFont.family, fontSize: chartFont.size };

/** Props comunes de `XAxis` / `YAxis`: etiquetas en condensada y filete en lugar de línea gruesa. */
export const axisProps = {
  tick,
  stroke: chartColors.border,
  tickLine: false,
} as const;

/** Props de `CartesianGrid`: solo líneas horizontales, en filete. */
export const gridProps = { stroke: chartColors.border, vertical: false } as const;

/** Barras de borde recto. */
export const barProps = { radius: 0, isAnimationActive: false } as const;

export const FAILURE_PATTERN_ID = 'garita-failure-pattern';
/** Relleno para las marcas de falla; requiere `<defs><FailurePattern /></defs>` dentro del gráfico. */
export const failureFill = `url(#${FAILURE_PATTERN_ID})`;

/** Trama diagonal roja: distingue las fallas sin depender del color. Va dentro de `<defs>`. */
export function FailurePattern({ id = FAILURE_PATTERN_ID }: { id?: string }) {
  return createElement(
    'pattern',
    { id, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
    createElement('rect', { width: 6, height: 6, fill: chartColors.paper }),
    createElement('line', {
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 6,
      stroke: chartColors.failure,
      strokeWidth: 3,
    }),
  );
}

interface TooltipEntry {
  name?: string | number;
  value?: ReactNode;
}

/** Tooltip: recuadro de hoja con borde de 1,5 px, sin sombra. Se pasa como `content` del `Tooltip`. */
export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: ReactNode;
}) {
  if (!active || !payload?.length) return null;
  return createElement(
    'div',
    {
      'data-slot': 'chart-tooltip',
      className: 'border-[1.5px] border-input bg-card px-3 py-2 text-sm text-card-foreground',
    },
    label != null && createElement('p', { className: 't-label mb-1 text-muted-foreground' }, label),
    ...payload.map((e, i) =>
      createElement(
        'p',
        { key: i, className: 'tabular-nums' },
        e.name != null &&
          createElement('span', { className: 'text-muted-foreground' }, `${e.name}: `),
        createElement('span', { className: 'font-semibold' }, e.value),
      ),
    ),
  );
}

/** Props comunes de `Tooltip`: el recuadro de hoja y un cursor plano. */
export const tooltipProps = {
  content: createElement(ChartTooltip),
  cursor: { fill: 'var(--muted)' },
  isAnimationActive: false,
} as const;

/** Trama diagonal roja de las fallas: no depende solo del color para distinguirlas. */
export const FAILURE_HATCH =
  'repeating-linear-gradient(45deg, var(--danger) 0 3px, transparent 3px 7px)';
