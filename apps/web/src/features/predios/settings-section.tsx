import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Título de una sección de configuración: por encima de los rótulos de campo (t-label). */
export const settingsTitleClass = 'font-cond text-lg font-semibold tracking-wider uppercase';

/**
 * Una fila de configuración: a la izquierda qué es y a qué afecta, a la derecha los controles.
 * En pantallas angostas se apilan.
 */
export function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'grid gap-x-8 gap-y-3 p-5 lg:grid-cols-[--spacing(64)_minmax(0,1fr)]',
        className,
      )}
    >
      <div className="space-y-1.5">
        <h3 id={titleId} className={cn(settingsTitleClass, 'text-foreground')}>
          {title}
        </h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
