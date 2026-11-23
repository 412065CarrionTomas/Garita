import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { faqEntries } from '@garita/shared';
import type { AuthMeResponse, UserRole } from '@garita/shared';

import { useAuth } from '../auth/auth-context';
import { FaqPage, PublicFaqPage } from './faq-page';

jest.mock('../auth/auth-context', () => ({ useAuth: jest.fn() }));
const useAuthMock = jest.mocked(useAuth);

function mockRole(role: UserRole) {
  const user: AuthMeResponse = {
    id: 'u1',
    firstName: 'Ana',
    lastName: 'García',
    email: 'ana@example.com',
    role,
    status: 'active',
    company: { id: 'c1', name: 'Seguridad Norte' },
    allowedChannels: ['web'],
  };
  useAuthMock.mockReturnValue({
    user,
    loading: false,
    login: jest.fn(),
    logout: jest.fn(),
    recover: jest.fn(),
    acceptLegal: jest.fn(),
    error: '',
    clearError: jest.fn(),
  });
}

const questions = (predicate: (audiences: readonly string[]) => boolean) =>
  faqEntries.filter((entry) => predicate(entry.audiences)).map((entry) => entry.question);

describe('PublicFaqPage', () => {
  it('muestra solo la información general', () => {
    render(
      <MemoryRouter>
        <PublicFaqPage />
      </MemoryRouter>,
    );
    for (const question of questions((a) => a.includes('public')))
      expect(screen.getByText(question)).toBeInTheDocument();
    for (const question of questions((a) => !a.includes('public')))
      expect(screen.queryByText(question)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute(
      'href',
      '/ingresar',
    );
  });
});

describe('FaqPage', () => {
  it.each(['admin', 'supervisor', 'client'] as const)(
    'muestra lo del rol %s y nada ajeno',
    (role) => {
      mockRole(role);
      render(<FaqPage />);
      for (const question of questions((a) => a.includes(role) || a.includes('public')))
        expect(screen.getByText(question)).toBeInTheDocument();
      for (const question of questions((a) => !a.includes(role) && !a.includes('public')))
        expect(screen.queryByText(question)).not.toBeInTheDocument();
    },
  );

  it('filtra con la búsqueda y ofrece borrarla cuando no hay resultados', () => {
    mockRole('admin');
    render(<FaqPage />);
    const search = screen.getByRole('searchbox', { name: 'Buscar en las preguntas' });
    fireEvent.change(search, { target: { value: 'zzzz-sin-coincidencias' } });
    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Borrar búsqueda' }));
    expect(search).toHaveValue('');
    expect(screen.queryByText('Sin resultados')).not.toBeInTheDocument();
  });
});
