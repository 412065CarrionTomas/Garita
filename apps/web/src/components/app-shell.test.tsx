import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ThemeProvider } from '@/lib/theme';
import { AppShell } from './app-shell';

it('muestra la navegación del rol, los datos del usuario y cierra sesión', async () => {
  const onLogout = jest.fn();
  render(
    <ThemeProvider>
      <AppShell
        homePath="/turnos"
        sections={[
          { path: '/turnos', title: 'Turnos' },
          { path: '/personal', title: 'Personal' },
        ]}
        userName="Ana Pérez"
        roleLabel="Supervisor"
        companyName="Seguridad Norte"
        onLogout={onLogout}
      >
        <p>contenido</p>
      </AppShell>
    </ThemeProvider>,
  );

  const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
  expect(nav).toHaveTextContent('Turnos');
  expect(nav).toHaveTextContent('Personal');
  expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
  expect(screen.getByText(/Supervisor · Seguridad Norte/)).toBeInTheDocument();
  expect(screen.getByText('contenido')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
  expect(onLogout).toHaveBeenCalledTimes(1);
});

it('muestra la hora en la barra y el menú móvil abre las mismas secciones', async () => {
  render(
    <ThemeProvider>
      <AppShell
        homePath="/turnos"
        sections={[{ path: '/turnos', title: 'Turnos' }]}
        userName="Ana Pérez"
        roleLabel="Supervisor"
        companyName="Seguridad Norte"
        onLogout={jest.fn()}
      >
        <p>contenido</p>
      </AppShell>
    </ThemeProvider>,
  );

  expect(document.querySelector('time')).toHaveTextContent(/^\d{2}:\d{2}$/);
  await userEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
  // El diálogo oculta (aria-hidden) la barra de fondo: queda solo la navegación del panel.
  expect(await screen.findByRole('navigation', { name: 'Navegación principal' })).toHaveTextContent(
    'Turnos',
  );
});
