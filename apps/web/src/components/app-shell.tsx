import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { LogOutIcon, MenuIcon } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/theme-toggle';
import { NotificationControl } from '@/features/notificaciones/notification-control';
import { cn } from '@/lib/utils';

export interface NavSection {
  path: string;
  title: string;
}

/** Foco sobre la barra de tinta: el aro global (tinta) no se vería. */
const BAR_FOCUS =
  'outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-bar-foreground';

function Brand({ to }: { to: string }) {
  return (
    <Link to={to} className={cn('flex items-center gap-2.5', BAR_FOCUS)}>
      <img src="/logo.svg" alt="" className="size-8 rounded-sm" />
      <span className="font-cond text-xl font-semibold tracking-[0.08em] text-bar-foreground">
        GARITA
      </span>
    </Link>
  );
}

/** Hora de la barra en un sello; se actualiza cada medio minuto. */
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date());
    }, 30_000);
    return () => {
      clearInterval(id);
    };
  }, []);
  return (
    <time
      dateTime={now.toISOString()}
      className="t-stamp rounded-sm border-[1.5px] border-bar-muted px-2 py-0.5 text-bar-foreground"
    >
      {now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}
    </time>
  );
}

function Tabs({
  sections,
  onNavigate,
  vertical,
}: {
  sections: NavSection[];
  onNavigate?: () => void;
  vertical?: boolean;
}) {
  return (
    <nav
      aria-label="Navegación principal"
      className={cn('flex', vertical ? 'flex-col' : 'h-full items-stretch gap-1')}
    >
      {sections.map((section) => (
        <NavLink
          key={section.path}
          to={section.path}
          onClick={onNavigate}
          className={({ isActive }: { isActive: boolean }) =>
            cn(
              'flex items-center px-3 text-sm',
              vertical ? 'h-12 border-l-[3px]' : 'border-b-[3px] pt-[3px]',
              BAR_FOCUS,
              isActive
                ? 'border-bar-foreground font-semibold text-bar-foreground'
                : 'border-transparent font-medium text-bar-muted hover:text-bar-foreground',
            )
          }
        >
          {section.title}
        </NavLink>
      ))}
    </nav>
  );
}

function AccountControls({
  userName,
  roleLabel,
  companyName,
  onLogout,
}: {
  userName: string;
  roleLabel: string;
  companyName: string;
  onLogout: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 text-right text-xs leading-tight">
        <p className="truncate font-semibold text-bar-foreground">{userName}</p>
        <p className="truncate text-bar-muted">
          {roleLabel} · {companyName}
        </p>
      </div>
      <Clock />
      <ThemeToggle />
      <NotificationControl />
      <button
        type="button"
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
        onClick={onLogout}
        className={cn(
          'flex size-9 items-center justify-center rounded-md text-bar-muted hover:text-bar-foreground',
          BAR_FOCUS,
        )}
      >
        <LogOutIcon className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Estructura de todas las pantallas autenticadas del panel: barra superior de 52 px en tinta con
 * pestañas de texto y, a la derecha, usuario, reloj y controles. Bajo 1024 px las pestañas pasan
 * a un panel lateral que abre el botón de menú.
 */
export function AppShell({
  homePath,
  sections,
  userName,
  roleLabel,
  companyName,
  onLogout,
  children,
}: {
  homePath: string;
  sections: NavSection[];
  userName: string;
  roleLabel: string;
  companyName: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const account = { userName, roleLabel, companyName, onLogout };
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:border-2 focus:border-primary focus:bg-card focus:px-3 focus:py-2 focus:text-sm"
      >
        Saltar al contenido
      </a>
      <header className="sticky top-0 z-20 flex h-[52px] items-center gap-6 bg-bar px-5 text-bar-foreground">
        <Brand to={homePath} />
        <div className="hidden h-full flex-1 lg:block">
          <Tabs sections={sections} />
        </div>
        <div className="ml-auto hidden lg:block">
          <AccountControls {...account} />
        </div>
        <div className="ml-auto lg:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="Abrir menú"
                className={cn(
                  'flex size-11 items-center justify-center rounded-md text-bar-foreground',
                  BAR_FOCUS,
                )}
              >
                <MenuIcon aria-hidden="true" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 gap-0 bg-bar p-0 text-bar-foreground">
              <SheetTitle className="sr-only">Menú</SheetTitle>
              <SheetDescription className="sr-only">Secciones del panel</SheetDescription>
              <div className="flex h-full flex-col gap-6 p-4">
                <Tabs
                  vertical
                  sections={sections}
                  onNavigate={() => {
                    setOpen(false);
                  }}
                />
                <div className="mt-auto border-t border-bar-muted/40 pt-4">
                  <AccountControls {...account} />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>
      <main id="contenido" className="w-full flex-1 space-y-6 px-5 py-6 sm:px-6 lg:px-7">
        {children}
      </main>
    </div>
  );
}
