import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

export type WindowStatus = 'ontime' | 'late' | 'missed' | 'current' | 'pending';

const box: Record<WindowStatus, string> = {
  ontime: 'border-foreground bg-foreground',
  late: 'border-warning bg-warning',
  missed: 'border-danger',
  current: 'border-foreground',
  pending: 'border-input',
};

// Tachado diagonal (no realizada) y relleno hasta la mitad (en curso): forma además de color.
const fill: Partial<Record<WindowStatus, CSSProperties>> = {
  missed: {
    background: 'linear-gradient(45deg, transparent 44%, var(--danger) 44% 56%, transparent 56%)',
  },
  current: { background: 'linear-gradient(to top, var(--foreground) 50%, transparent 50%)' },
};

const NAMES: [WindowStatus, string, string][] = [
  ['late', 'tardía', 'tardías'],
  ['missed', 'no realizada', 'no realizadas'],
  ['current', 'en curso', 'en curso'],
  ['pending', 'pendiente', 'pendientes'],
];

function describe(windows: { status: WindowStatus }[]) {
  const count = (s: WindowStatus) => windows.filter((w) => w.status === s).length;
  const parts = [`${count('ontime')} de ${windows.length} ventanas a tiempo`];
  for (const [s, one, many] of NAMES) {
    const n = count(s);
    if (n) parts.push(`${n} ${n === 1 ? one : many}`);
  }
  return parts.join(', ');
}

/** Hilera de casilleros, uno por ventana de ronda. En grilla se estiran hasta 56 px de ancho. */
export function WindowBar({
  windows,
  size = 'row',
  className,
}: {
  windows: { status: WindowStatus }[];
  size?: 'row' | 'grid';
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={describe(windows)}
      data-slot="window-bar"
      className={cn('flex gap-1', className)}
    >
      {windows.map((w, i) => (
        <span
          key={i}
          aria-hidden="true"
          data-status={w.status}
          style={fill[w.status]}
          className={cn(
            'block rounded-xs border-[1.5px]',
            size === 'row' ? 'h-4 w-2.5' : 'h-6.5 min-w-6 max-w-14 flex-1',
            box[w.status],
          )}
        />
      ))}
    </span>
  );
}
