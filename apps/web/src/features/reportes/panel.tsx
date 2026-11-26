import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Hoja de la pantalla de cumplimiento: título en condensada, acciones a la derecha y un cuerpo con
 * desplazamiento propio (`bodyClassName` le pone el alto máximo), para que la página no se estire.
 * El cuerpo es enfocable para desplazarlo con el teclado.
 */
export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card text-sm text-card-foreground',
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <h2 id={titleId} className="font-cond text-lg font-semibold tracking-wider uppercase">
          {title}
        </h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div
        role="group"
        aria-labelledby={titleId}
        tabIndex={0}
        className={cn('min-h-0 flex-1 overflow-auto', bodyClassName)}
      >
        {children}
      </div>
    </section>
  );
}
