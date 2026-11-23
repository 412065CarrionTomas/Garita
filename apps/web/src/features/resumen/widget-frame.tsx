import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Hoja de un bloque del resumen: título en condensada, acción hacia la pantalla completa y un
 * cuerpo con desplazamiento propio que se adapta a su tamaño (container queries), no al de la
 * ventana. El cuerpo es enfocable para poder desplazarlo con el teclado.
 */
export function WidgetFrame({
  title,
  link,
  aside,
  children,
  inverted = false,
  className,
}: {
  title: string;
  link?: { to: string; label: string };
  aside?: ReactNode;
  children: ReactNode;
  /** Hoja en tinta, como la barra de navegación: para la columna de pendientes. */
  inverted?: boolean;
  className?: string;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-md border',
        inverted
          ? 'border-bar bg-bar text-bar-foreground'
          : 'border-border bg-card text-card-foreground',
        className,
      )}
    >
      <header
        className={cn(
          'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-5 py-3',
          inverted ? 'border-bar-muted/40' : 'border-border',
        )}
      >
        <h2 id={titleId} className="font-cond text-lg font-semibold tracking-wider uppercase">
          {title}
        </h2>
        <div className="flex items-center gap-3">
          {aside}
          {link && (
            <Link
              to={link.to}
              className="text-sm font-semibold whitespace-nowrap underline-offset-4 hover:underline"
            >
              {link.label} →
            </Link>
          )}
        </div>
      </header>
      <div
        role="group"
        aria-labelledby={titleId}
        tabIndex={0}
        className="@container min-h-0 flex-1 overflow-auto"
      >
        {children}
      </div>
    </section>
  );
}

/** Estado de carga y de error de un bloque: no tira abajo al resto del resumen. */
export function WidgetStatus({
  query,
  label,
}: {
  query: { isPending: boolean; isError: boolean; refetch: () => unknown };
  label: string;
}) {
  if (query.isPending)
    return (
      <div role="status" aria-label={`Cargando ${label}`} className="space-y-3 p-5">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-5/6" />
      </div>
    );
  if (query.isError)
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-5 text-sm">
        <p>No pudimos cargar {label}.</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          Reintentar
        </Button>
      </div>
    );
  return null;
}

/** Bloque sin datos en el período: una línea, sin ocupar como un estado vacío de pantalla. */
export function WidgetEmpty({ children }: { children: ReactNode }) {
  return <p className="p-5 text-sm text-muted-foreground">{children}</p>;
}
