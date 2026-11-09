import type { ReactNode } from 'react';

/**
 * Marco común de las pantallas sin sesión (ingresar, recuperar, activar): marca, título en
 * condensada, una línea de contexto y el contenido. Una sola acción primaria por pantalla.
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full min-w-0 max-w-md space-y-6">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="" className="size-8" />
          <span className="font-cond text-xl font-semibold uppercase tracking-wider">Garita</span>
        </div>
        <div className="space-y-6 rounded-lg border-2 border-primary bg-card p-6">
          <header className="space-y-1">
            <h1 className="t-headline">{title}</h1>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </header>
          {children}
        </div>
        {footer}
      </div>
    </main>
  );
}
