import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Lista o tabla sin datos: título en condensada, una línea de recuperación y la acción que lo resuelve. */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border border-dashed border-input px-6 py-10 text-center',
        className,
      )}
    >
      <p className="font-cond text-xl font-semibold uppercase tracking-wider text-foreground">
        {title}
      </p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
