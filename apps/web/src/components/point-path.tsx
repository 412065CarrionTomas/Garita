import type { KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

export type PointStatus = 'done' | 'next' | 'missed' | 'pending';

export interface PathPoint {
  id: string;
  label: string;
  status: PointStatus;
}

const POINT_STATUS_LABEL: Record<PointStatus, string> = {
  done: 'Registrado',
  next: 'Próximo',
  missed: 'Sin registro',
  pending: 'Pendiente',
};

// Geometría del dibujo (unidades del viewBox).
const PER_ROW = 10;
const DX = 56;
const DY = 72;
const R = 9;
const BEND = 14; // el giro entre filas: 45°, tramo recto de 90°, 45°
const PAD_X = BEND + R + 8;
const PAD_TOP = R + 12;
const PAD_BOTTOM = R + 24;

function layout(n: number) {
  const cols = Math.min(n, PER_ROW);
  const rows = Math.ceil(n / PER_ROW);
  const pos = (i: number) => {
    const row = Math.floor(i / PER_ROW);
    const col = i % PER_ROW;
    const x = PAD_X + (row % 2 === 0 ? col : cols - 1 - col) * DX;
    return { x, y: PAD_TOP + row * DY, row };
  };
  return {
    pos,
    width: PAD_X * 2 + (cols - 1) * DX,
    height: PAD_TOP + PAD_BOTTOM + (rows - 1) * DY,
  };
}

/**
 * Camino lineal de una ronda: serpentea en filas de hasta 10 puntos y solo dobla a 45° y 90°.
 * Registrado = círculo lleno; próximo = círculo con aro; sin registro = contorno con cruz;
 * pendiente = hueco con línea punteada. Cada punto es un botón accesible por teclado.
 */
export function PointPath({
  points,
  selectedId,
  highlightedIds,
  onSelect,
  title = 'Camino de la ronda',
  className,
}: {
  points: PathPoint[];
  selectedId?: string | null;
  highlightedIds?: string[];
  onSelect?: (id: string) => void;
  title?: string;
  className?: string;
}) {
  if (points.length === 0) return null;
  const { pos, width, height } = layout(points.length);

  const segments = points.slice(1).map((p, k) => {
    const a = pos(k);
    const b = pos(k + 1);
    let d = `M${a.x} ${a.y}L${b.x} ${b.y}`;
    if (a.row !== b.row) {
      const s = a.row % 2 === 0 ? 1 : -1;
      d = `M${a.x} ${a.y}l${s * BEND} ${BEND}V${b.y - BEND}l${-s * BEND} ${BEND}`;
    }
    return { id: p.id, d, solid: p.status === 'done' || p.status === 'missed' };
  });

  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(id);
    }
  };

  return (
    <svg
      role="group"
      aria-label={title}
      data-slot="point-path"
      viewBox={`0 0 ${width} ${height}`}
      className={cn('block h-auto w-full max-w-160', className)}
    >
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {segments.map((s) => (
          <path
            key={s.id}
            d={s.d}
            strokeWidth={s.solid ? 4 : 3}
            strokeDasharray={s.solid ? undefined : '1 8'}
            className={s.solid ? 'stroke-foreground' : 'stroke-muted-foreground'}
          />
        ))}
      </g>
      {points.map((p, i) => {
        const { x, y } = pos(i);
        const selected = p.id === selectedId;
        const lit = highlightedIds?.includes(p.id) ?? false;
        const filled = p.status === 'done' || p.status === 'next';
        return (
          <g
            key={p.id}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`Punto ${i + 1}, ${p.label}: ${POINT_STATUS_LABEL[p.status]}`}
            data-status={p.status}
            className="cursor-pointer"
            onClick={() => {
              onSelect?.(p.id);
            }}
            onKeyDown={(e) => {
              onKey(e, p.id);
            }}
          >
            <circle cx={x} cy={y} r={R + 8} className="fill-transparent" />
            {selected && (
              <circle
                cx={x}
                cy={y}
                r={R + 10}
                strokeWidth={3}
                className="fill-none stroke-foreground"
              />
            )}
            {p.status === 'next' && (
              <circle
                cx={x}
                cy={y}
                r={R + 5}
                strokeWidth={2}
                className="fill-none stroke-foreground"
              />
            )}
            <circle
              cx={x}
              cy={y}
              r={R}
              strokeWidth={lit ? 4.5 : 3}
              className={cn(
                filled ? 'fill-foreground' : 'fill-card',
                p.status === 'missed' ? 'stroke-danger' : 'stroke-foreground',
              )}
            />
            {p.status === 'missed' && (
              <path
                d={`M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8`}
                strokeWidth={2.2}
                strokeLinecap="round"
                className="stroke-danger"
              />
            )}
            <text
              x={x}
              y={y + R + 18}
              textAnchor="middle"
              className={cn(
                'font-cond text-xs tracking-wide',
                lit || selected
                  ? 'fill-foreground font-bold'
                  : 'fill-muted-foreground font-semibold',
              )}
            >
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
