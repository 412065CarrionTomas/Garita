import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import {
  Building2Icon,
  CalendarClockIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MapPinIcon,
  MenuIcon,
  RadioIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  UsersIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
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

const COLLAPSED_KEY = 'garita-sidebar-collapsed';

const ICONS: Record<string, typeof UsersIcon> = {
  '/supervision': RadioIcon,
  '/resumen': LayoutDashboardIcon,
  '/turnos': CalendarClockIcon,
  '/mis-turnos': CalendarClockIcon,
  '/personal': UsersIcon,
  '/clientes': Building2Icon,
  '/predios': MapPinIcon,
  '/reportes': FileTextIcon,
};

function Brand({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <img src="/logo.svg" alt="" className="size-8 rounded-lg" />
      <span className="text-lg font-semibold tracking-tight text-sidebar-accent-foreground">
        Garita
      </span>
    </Link>
  );
}

function SidebarContent({
  homePath,
  sections,
  userName,
  roleLabel,
  companyName,
  onLogout,
  onNavigate,
  onCollapse,
}: {
  homePath: string;
  sections: NavSection[];
  userName: string;
  roleLabel: string;
  companyName: string;
  onLogout: () => void;
  onNavigate?: () => void;
  onCollapse?: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="space-y-1 px-1">
        <div className="flex items-center justify-between">
          <Brand to={homePath} />
          {onCollapse && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Ocultar menú"
              onClick={onCollapse}
              className="hidden text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground lg:inline-flex"
            >
              <PanelLeftCloseIcon aria-hidden="true" />
            </Button>
          )}
        </div>
        <p className="truncate pl-[2.625rem] text-xs text-sidebar-foreground">{companyName}</p>
      </div>
      <nav aria-label="Navegación principal" className="flex flex-1 flex-col gap-1">
        {sections.map((section) => {
          const Icon = ICONS[section.path] ?? FileTextIcon;
          return (
            <NavLink
              key={section.path}
              to={section.path}
              onClick={onNavigate}
              className={({ isActive }: { isActive: boolean }) =>
                cn(
                  'relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r-full before:bg-sidebar-primary'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                )
              }
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {section.title}
            </NavLink>
          );
        })}
      </nav>
      <div className="space-y-3 border-t border-sidebar-border pt-4">
        <div className="px-1">
          <p className="truncate text-sm font-medium text-sidebar-accent-foreground">{userName}</p>
          <p className="text-xs text-sidebar-foreground">{roleLabel}</p>
        </div>
        <ThemeToggle />
        <NotificationControl />
        <Button
          type="button"
          variant="ghost"
          onClick={onLogout}
          className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
        >
          <LogOutIcon aria-hidden="true" />
          Cerrar sesión
        </Button>
      </div>
    </div>
  );
}

/**
 * Estructura de todas las pantallas autenticadas del panel: sidebar fijo desde 1024 px y,
 * en pantallas chicas, una barra superior que abre el mismo menú en un panel lateral.
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
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setSidebarCollapsed = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // Sin almacenamiento (modo privado): vale solo para esta sesión.
    }
  };
  const sidebar = { homePath, sections, userName, roleLabel, companyName, onLogout };
  return (
    <div
      className={cn(
        'min-h-svh lg:grid',
        collapsed ? 'lg:grid-cols-1' : 'lg:grid-cols-[15rem_minmax(0,1fr)]',
      )}
    >
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Saltar al contenido
      </a>
      <aside
        className={cn(
          'sticky top-0 hidden h-svh border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
          collapsed ? 'lg:hidden' : 'lg:block',
        )}
      >
        <SidebarContent
          {...sidebar}
          onCollapse={() => {
            setSidebarCollapsed(true);
          }}
        />
      </aside>
      <div className="flex min-w-0 flex-col">
        {collapsed && (
          <div className="hidden h-14 items-center px-4 lg:flex">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Mostrar menú"
              onClick={() => {
                setSidebarCollapsed(false);
              }}
            >
              <PanelLeftOpenIcon aria-hidden="true" />
            </Button>
          </div>
        )}
        <div className="sticky top-0 z-20 flex h-14 items-center justify-between bg-sidebar px-4 text-sidebar-foreground lg:hidden">
          <Brand to={homePath} />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Abrir menú"
                className="text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              >
                <MenuIcon aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-64 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
            >
              <SheetTitle className="sr-only">Menú</SheetTitle>
              <SheetDescription className="sr-only">Secciones del panel</SheetDescription>
              <SidebarContent
                {...sidebar}
                onNavigate={() => {
                  setOpen(false);
                }}
              />
            </SheetContent>
          </Sheet>
        </div>
        <main
          id="contenido"
          className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6 lg:p-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
