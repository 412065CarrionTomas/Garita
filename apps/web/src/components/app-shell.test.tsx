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
  expect(screen.getByText('Seguridad Norte')).toBeInTheDocument();
  expect(screen.getByText('contenido')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
  expect(onLogout).toHaveBeenCalledTimes(1);
});
