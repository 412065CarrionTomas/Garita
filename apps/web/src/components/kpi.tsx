import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Una cifra de una franja de indicadores (`<dl>`): rótulo, número grande y una línea que lo explica. */
export function Kpi({
  label,
  value,
  detail,
  tone,
  stamp,
  className,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  tone?: string;
  stamp?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1 bg-card px-4 py-3', className)}>
      <dt className="t-label text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2">
        <span className={cn('t-numeral text-3xl leading-none', tone)}>{value}</span>
        {stamp}
      </dd>
      <dd className="text-sm text-muted-foreground">{detail}</dd>
    </div>
  );
}
