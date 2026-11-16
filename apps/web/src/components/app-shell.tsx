import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import {
  BellOffIcon,
  CheckIcon,
  ChevronDownIcon,
  LogOutIcon,
  MenuIcon,
  MoonIcon,
  SunIcon,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { NotificationControl } from '@/features/notificaciones/notification-control';
import { notificationsEnabled } from '@/features/notificaciones/notifications';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

export interface NavLinkItem {
  path: string;
  title: string;
  /** Pendientes de la sección; el contador solo se dibuja si es mayor que cero. */
  count?: number;
  /** Rojo para fallas, ámbar para demoras; sin tono, recuadro en tinta. */
  tone?: 'danger' | 'warning';
}

export interface NavGroup {
  title: string;
  children: NavLinkItem[];
}

export type NavSection = NavLinkItem | NavGroup;

const THEME_SIDE = 'flex h-6 w-8 items-center justify-center';

/** Foco sobre la barra de tinta: el aro global (tinta) no se vería. */
const BAR_FOCUS =
  'outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-bar-foreground';

/** Bajo 1280 px el menú se usa con el dedo: los ítems crecen al mínimo táctil. */
const MENU_ITEM = 'max-xl:min-h-11';

function isGroup(section: NavSection): section is NavGroup {
  return 'children' in section;
}

/** La sección activa es la de ruta más larga que contiene la actual (la cola no activa el listado). */
function findActivePath(pathname: string, sections: NavSection[]): string | undefined {
  return sections
    .flatMap((section) => (isGroup(section) ? section.children : [section]))
    .map((item) => item.path)
    .filter((path) => pathname === path || pathname.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];
}

function groupSummary(group: NavGroup): Pick<NavLinkItem, 'count' | 'tone'> {
  const pending = group.children.filter((item) => (item.count ?? 0) > 0);
  return {
    count: pending.reduce((total, item) => total + (item.count ?? 0), 0),
    tone: pending.some((item) => item.tone === 'danger')
      ? 'danger'
      : pending.find((item) => item.tone)?.tone,
  };
}

function labelWithCount(item: Pick<NavLinkItem, 'count'> & { title: string }): string | undefined {
  return item.count ? `${item.title} (${String(item.count)})` : undefined;
}

/** Contador en sello; el nombre accesible lo lleva el enlace, por eso va oculto al lector. */
function Count({ count, tone }: Pick<NavLinkItem, 'count' | 'tone'>) {
  if (!count) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        't-stamp rounded-sm px-1.5',
        tone === 'danger' && 'bg-danger text-danger-foreground',
        tone === 'warning' && 'bg-warning text-warning-foreground',
        !tone && 'border-[1.5px] border-current',
      )}
    >
      {count}
    </span>
  );
}

function tabClass(active: boolean, vertical?: boolean) {
  return cn(
    'flex items-center gap-1.5 px-3 text-sm whitespace-nowrap',
    vertical ? 'h-12 border-l-[3px]' : 'border-b-[3px] pt-[3px]',
    BAR_FOCUS,
    active
      ? 'border-bar-foreground font-semibold text-bar-foreground'
      : 'border-transparent font-medium text-bar-muted hover:text-bar-foreground',
  );
}

function Brand({ to }: { to: string }) {
  return (
    <Link to={to} className={cn('flex shrink-0 items-center gap-2.5', BAR_FOCUS)}>
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
      className="t-stamp shrink-0 rounded-sm border-[1.5px] border-bar-muted px-2 py-0.5 text-bar-foreground"
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
  const activePath = findActivePath(useLocation().pathname, sections);
  const link = (item: NavLinkItem) => (
    <Link
      key={item.path}
      to={item.path}
      onClick={onNavigate}
      aria-current={item.path === activePath ? 'page' : undefined}
      aria-label={labelWithCount(item)}
      className={tabClass(item.path === activePath, vertical)}
    >
      {item.title}
      <Count count={item.count} tone={item.tone} />
    </Link>
  );
  return (
    <nav
      aria-label="Navegación principal"
      className={cn('flex', vertical ? 'flex-col' : 'h-full items-stretch gap-1')}
    >
      {sections.map((section) => {
        if (!isGroup(section)) return link(section);
        // En el panel lateral los grupos van desplegados bajo su rótulo, sin menús anidados.
        if (vertical)
          return (
            <div
              key={section.title}
              role="group"
              aria-label={section.title}
              className="flex flex-col"
            >
              <p aria-hidden="true" className="t-label px-3 pt-4 pb-1 text-bar-muted">
                {section.title}
              </p>
              {section.children.map(link)}
            </div>
          );
        const summary = groupSummary(section);
        return (
          <DropdownMenu key={section.title}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={labelWithCount({ title: section.title, count: summary.count })}
                className={tabClass(section.children.some((item) => item.path === activePath))}
              >
                {section.title}
                <Count {...summary} />
                <ChevronDownIcon className="size-3.5" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-60">
              {section.children.map((item) => (
                <DropdownMenuItem key={item.path} asChild className={MENU_ITEM}>
                  <Link
                    to={item.path}
                    aria-current={item.path === activePath ? 'page' : undefined}
                    aria-label={labelWithCount(item)}
                    className={cn('justify-between', item.path === activePath && 'font-semibold')}
                  >
                    {item.title}
                    <Count count={item.count} tone={item.tone} />
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </nav>
  );
}

/** Menú de la cuenta: tema, estado de las notificaciones, accesos de configuración y salida. */
function UserMenu({
  userName,
  roleLabel,
  companyName,
  accountLinks,
  onLogout,
  onNavigate,
}: {
  userName: string;
  roleLabel: string;
  companyName: string;
  accountLinks: NavLinkItem[];
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  const { mode, setMode } = useTheme();
  // Sin elección guardada manda el sistema; el interruptor muestra el tema que se está viendo.
  const dark =
    mode === 'dark' || (mode === 'system' && document.documentElement.classList.contains('dark'));
  const enabled = notificationsEnabled();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex min-h-11 max-w-56 min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs leading-tight hover:bg-bar-foreground/10 xl:min-h-9 xl:text-right',
            BAR_FOCUS,
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-bar-foreground">{userName}</span>
            <span className="block truncate text-bar-muted">
              {roleLabel} · {companyName}
            </span>
          </span>
          <ChevronDownIcon className="size-4 shrink-0 text-bar-muted" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Notificaciones</DropdownMenuLabel>
        <p className="flex items-center gap-1.5 px-1.5 py-1 text-sm text-muted-foreground">
          {enabled ? (
            <CheckIcon className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <BellOffIcon className="size-4 shrink-0" aria-hidden="true" />
          )}
          {enabled ? 'Activadas en este dispositivo' : 'Sin activar en este dispositivo'}
        </p>
        <DropdownMenuSeparator />
        {accountLinks.map((item) => (
          <DropdownMenuItem key={item.path} asChild className={MENU_ITEM}>
            <Link to={item.path} onClick={onNavigate}>
              {item.title}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem className={MENU_ITEM} onSelect={onLogout}>
          <LogOutIcon aria-hidden="true" />
          Cerrar sesión
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          role="menuitemcheckbox"
          aria-checked={dark}
          aria-label="Tema oscuro"
          className={cn(MENU_ITEM, 'justify-between')}
          // El menú queda abierto para ver el cambio de tema.
          onSelect={(event) => {
            event.preventDefault();
            setMode(dark ? 'light' : 'dark');
          }}
        >
          Tema
          <span
            aria-hidden="true"
            className="flex overflow-hidden rounded-full border-[1.5px] border-input"
          >
            <span className={cn(THEME_SIDE, !dark && 'bg-primary text-primary-foreground')}>
              <SunIcon className="size-3.5" />
            </span>
            <span className={cn(THEME_SIDE, dark && 'bg-primary text-primary-foreground')}>
              <MoonIcon className="size-3.5" />
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Estructura de todas las pantallas autenticadas del panel: barra superior de 52 px en tinta con
 * pestañas de texto (las secciones afines se agrupan en un desplegable) y, a la derecha, reloj y
 * menú de la cuenta. Bajo 1280 px las pestañas pasan a un panel lateral que abre el botón de menú.
 * `alert` es lo único que no puede quedar a un clic: se dibuja como sello rojo en la barra.
 */
export function AppShell({
  homePath,
  sections,
  accountLinks = [],
  alert,
  notice,
  userName,
  roleLabel,
  companyName,
  onLogout,
  children,
}: {
  homePath: string;
  sections: NavSection[];
  accountLinks?: NavLinkItem[];
  alert?: NavLinkItem;
  /** Estado anómalo del panel (por ejemplo, sin conexión en vivo); va como sello punteado. */
  notice?: string;
  userName: string;
  roleLabel: string;
  companyName: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const account = { userName, roleLabel, companyName, accountLinks, onLogout };
  const close = () => {
    setOpen(false);
  };
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:border-2 focus:border-primary focus:bg-card focus:px-3 focus:py-2 focus:text-sm"
      >
        Saltar al contenido
      </a>
      <header className="sticky top-0 z-20 flex h-[52px] items-center gap-4 bg-bar px-5 text-bar-foreground">
        <Brand to={homePath} />
        <div className="hidden h-full shrink-0 xl:block">
          <Tabs sections={sections} />
        </div>
        {!!alert?.count && (
          <Link
            to={alert.path}
            className={cn(
              't-stamp shrink-0 rounded-sm bg-danger px-2 py-0.5 text-danger-foreground',
              BAR_FOCUS,
            )}
          >
            {alert.title} {alert.count}
          </Link>
        )}
        {notice && (
          <p
            role="status"
            className="t-stamp shrink-0 rounded-sm border-[1.5px] border-dashed border-bar-muted px-2 py-0.5"
          >
            {notice}
          </p>
        )}
        <div className="ml-auto hidden min-w-0 items-center gap-3 xl:flex">
          <Clock />
          <NotificationControl />
          <UserMenu {...account} />
        </div>
        <div className="ml-auto xl:hidden">
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
              <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
                <Tabs vertical sections={sections} onNavigate={close} />
                <div className="mt-auto flex flex-col items-start gap-3 border-t border-bar-muted/40 pt-4">
                  <Clock />
                  <NotificationControl variant="sheet" />
                  <UserMenu {...account} onNavigate={close} />
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
