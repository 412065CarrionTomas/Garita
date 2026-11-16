import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { ThemeProvider } from '@/lib/theme';
import { AppShell } from './app-shell';
import type { NavLinkItem, NavSection } from './app-shell';

const SECTIONS: NavSection[] = [
  { path: '/turnos', title: 'Turnos' },
  {
    title: 'Incidentes',
    children: [
      { path: '/incidentes', title: 'Listado', count: 2 },
      { path: '/incidentes/cola', title: 'Por clasificar', count: 3, tone: 'warning' },
    ],
  },
];

function renderShell({
  at = '/turnos',
  sections = SECTIONS,
  alert,
  notice,
  onLogout = jest.fn(),
}: {
  at?: string;
  sections?: NavSection[];
  alert?: NavLinkItem;
  notice?: string;
  onLogout?: () => void;
} = {}) {
  // El router de los tests lee la ruta de window.location.
  window.history.pushState({}, '', at);
  render(
    <MemoryRouter>
      <ThemeProvider>
        <AppShell
          homePath="/turnos"
          sections={sections}
          accountLinks={[{ path: '/suscripcion', title: 'Suscripción y cobros' }]}
          alert={alert}
          notice={notice}
          userName="Ana Pérez"
          roleLabel="Supervisor"
          companyName="Seguridad Norte"
          onLogout={onLogout}
        >
          <p>contenido</p>
        </AppShell>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

async function openWithKeyboard(name: string | RegExp) {
  screen.getByRole('button', { name }).focus();
  await userEvent.keyboard('{Enter}');
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

it('muestra la navegación del rol y los datos del usuario', () => {
  renderShell();
  const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
  expect(nav).toHaveTextContent('Turnos');
  expect(nav).toHaveTextContent('Incidentes');
  expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
  expect(screen.getByText(/Supervisor · Seguridad Norte/)).toBeInTheDocument();
  expect(screen.getByText('contenido')).toBeInTheDocument();
});

it('el menú de la cuenta cambia el tema, enlaza la configuración y cierra sesión', async () => {
  const onLogout = jest.fn();
  renderShell({ onLogout });
  await openWithKeyboard(/Ana Pérez/);

  // Sin elección guardada manda el sistema; el interruptor fija claro u oscuro.
  expect(localStorage.getItem('garita-theme')).toBeNull();
  const theme = screen.getByRole('menuitemcheckbox', { name: 'Tema oscuro' });
  expect(theme).not.toBeChecked();
  await userEvent.click(theme);
  expect(document.documentElement).toHaveClass('dark');
  expect(localStorage.getItem('garita-theme')).toBe('dark');
  expect(theme).toBeChecked();
  await userEvent.click(theme);
  expect(document.documentElement).not.toHaveClass('dark');
  expect(localStorage.getItem('garita-theme')).toBe('light');

  expect(screen.getByText('Sin activar en este dispositivo')).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Suscripción y cobros' })).toHaveAttribute(
    'href',
    '/suscripcion',
  );
  await userEvent.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));
  expect(onLogout).toHaveBeenCalledTimes(1);
});

it('un grupo suma los pendientes de sus secciones y las lista con su contador', async () => {
  renderShell();
  await openWithKeyboard('Incidentes (5)');
  expect(screen.getByRole('menuitem', { name: 'Listado (2)' })).toHaveAttribute(
    'href',
    '/incidentes',
  );
  expect(screen.getByRole('menuitem', { name: 'Por clasificar (3)' })).toHaveAttribute(
    'href',
    '/incidentes/cola',
  );
});

it('sin pendientes el grupo no muestra contador', () => {
  renderShell({
    sections: [{ title: 'Pendientes', children: [{ path: '/avisos', title: 'Avisos', count: 0 }] }],
  });
  expect(screen.getByRole('button', { name: 'Pendientes' })).toBeInTheDocument();
});

it('en la cola de clasificación la sección activa es la cola, no el listado', async () => {
  renderShell({ at: '/incidentes/cola' });
  await openWithKeyboard('Incidentes (5)');
  expect(screen.getByRole('menuitem', { name: 'Por clasificar (3)' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(screen.getByRole('menuitem', { name: 'Listado (2)' })).not.toHaveAttribute('aria-current');
});

it('el detalle de un incidente mantiene activo el listado', async () => {
  renderShell({ at: '/incidentes/i1' });
  await openWithKeyboard('Incidentes (5)');
  expect(screen.getByRole('menuitem', { name: 'Listado (2)' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

it('el pánico activo queda a un clic en la barra', () => {
  renderShell({ alert: { path: '/alertas-panico', title: 'Pánico', count: 2 } });
  expect(screen.getByRole('link', { name: 'Pánico 2' })).toHaveAttribute('href', '/alertas-panico');
});

it('sin pánico activo no hay sello en la barra', () => {
  renderShell({ alert: { path: '/alertas-panico', title: 'Pánico', count: 0 } });
  expect(screen.queryByRole('link', { name: /Pánico/ })).not.toBeInTheDocument();
});

it('avisa en la barra cuando se pierde la conexión en vivo', () => {
  renderShell({ notice: 'Reconectando…' });
  expect(screen.getByRole('status')).toHaveTextContent('Reconectando…');
});

it('muestra la hora en la barra y el menú móvil despliega los grupos', async () => {
  renderShell();
  expect(document.querySelector('time')).toHaveTextContent(/^\d{2}:\d{2}$/);
  await userEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
  // El diálogo oculta (aria-hidden) la barra de fondo: queda solo la navegación del panel.
  const nav = await screen.findByRole('navigation', { name: 'Navegación principal' });
  expect(nav).toHaveTextContent('Turnos');
  expect(screen.getByRole('link', { name: 'Listado (2)' })).toBeInTheDocument();
});
