import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Lista o tabla sin datos: dice qué falta y ofrece la acción que lo resuelve. */
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
        'flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center',
        className,
      )}
    >
      <p className="font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
