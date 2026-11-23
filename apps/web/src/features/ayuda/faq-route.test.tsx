import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { useAuth } from '../auth/auth-context';
import { FaqLayout } from '../auth/routes';

jest.mock('../auth/auth-context', () => ({ useAuth: jest.fn() }));
const useAuthMock = jest.mocked(useAuth);

function mockSession(loading: boolean) {
  useAuthMock.mockReturnValue({
    user: null,
    loading,
    login: jest.fn(),
    logout: jest.fn(),
    recover: jest.fn(),
    acceptLegal: jest.fn(),
    error: '',
    clearError: jest.fn(),
  });
}

describe('FaqLayout', () => {
  it('espera la sesión en lugar de mostrar la vista pública', () => {
    mockSession(true);
    render(
      <MemoryRouter>
        <FaqLayout />
      </MemoryRouter>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Verificando sesión…');
    expect(screen.queryByRole('link', { name: 'Iniciar sesión' })).not.toBeInTheDocument();
  });

  it('sin sesión muestra la ayuda pública', () => {
    mockSession(false);
    render(
      <MemoryRouter>
        <FaqLayout />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute(
      'href',
      '/ingresar',
    );
  });
});
