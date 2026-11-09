import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Encabezado de toda pantalla del panel: título (h1) en condensada, una sola vez por pantalla,
 * una línea que explica para qué sirve y, a la derecha, la acción principal.
 */
export function PageHeader({
  title,
  description,
  actions,
  id,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0 space-y-1">
        <h1 id={id} className="t-headline text-foreground md:t-display">
          {title}
        </h1>
        {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
