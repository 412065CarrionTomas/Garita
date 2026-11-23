import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { SUSPENSION_MESSAGES } from '@garita/shared';
import { AccountSuspendedGate } from './account-suspended-gate';

beforeEach(() => {
  window.history.replaceState({}, '', '/reportes');
});
afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('HU-43 suspended gate', () => {
  it.each(['supervisor', 'client'] as const)(
    'announces the exact %s message instead of blocked content',
    (role) => {
      render(
        <MemoryRouter initialEntries={['/reportes']}>
          <AccountSuspendedGate suspended role={role}>
            <p>Datos restringidos</p>
          </AccountSuspendedGate>
        </MemoryRouter>,
      );
      expect(screen.getByRole('status')).toHaveTextContent(SUSPENSION_MESSAGES[role]);
      expect(screen.queryByText('Datos restringidos')).not.toBeInTheDocument();
    },
  );
  it('offers subscription and keeps the subscription page usable for admins', () => {
    window.history.replaceState({}, '', '/suscripcion');
    render(
      <MemoryRouter initialEntries={['/suscripcion']}>
        <AccountSuspendedGate suspended role="admin">
          <p>Pago</p>
        </AccountSuspendedGate>
      </MemoryRouter>,
    );
    expect(screen.getByText('Pago')).toBeInTheDocument();
  });
  it.each(['admin', 'supervisor', 'client'] as const)('keeps the FAQ readable for %s', (role) => {
    window.history.replaceState({}, '', '/ayuda');
    render(
      <MemoryRouter initialEntries={['/ayuda']}>
        <AccountSuspendedGate suspended role={role}>
          <p>Preguntas</p>
        </AccountSuspendedGate>
      </MemoryRouter>,
    );
    expect(screen.getByText('Preguntas')).toBeInTheDocument();
  });
  it('keeps live supervision usable and restores blocked content on reactivation', () => {
    window.history.replaceState({}, '', '/personal');
    const view = render(
      <MemoryRouter initialEntries={['/personal']}>
        <AccountSuspendedGate suspended role="supervisor">
          <p>Personal</p>
        </AccountSuspendedGate>
      </MemoryRouter>,
    );
    expect(screen.queryByText('Personal')).not.toBeInTheDocument();
    view.rerender(
      <MemoryRouter initialEntries={['/personal']}>
        <AccountSuspendedGate suspended={false} role="supervisor">
          <p>Personal</p>
        </AccountSuspendedGate>
      </MemoryRouter>,
    );
    expect(screen.getByText('Personal')).toBeInTheDocument();
  });
});
