import { fireEvent, render, screen } from '@testing-library/react';
import type { AuthMeResponse } from '@garita/shared';

import { LoginPage } from './login-page';
import { AuthFlowError, useAuth } from './auth-context';

jest.mock('./auth-context', () => ({
  useAuth: jest.fn(),
  AuthFlowError: class AuthFlowError extends Error {},
}));
const useAuthMock = jest.mocked(useAuth);

const profile: AuthMeResponse = {
  id: 'u1',
  firstName: 'Ana',
  lastName: 'García',
  email: 'ana@example.com',
  role: 'admin',
  status: 'active',
  company: { id: 'c1', name: 'Seguridad Norte' },
  allowedChannels: ['web', 'mobile'],
};

function renderLogin(
  user: AuthMeResponse | null = null,
  login = jest.fn().mockResolvedValue(profile),
) {
  useAuthMock.mockReturnValue({
    user,
    loading: false,
    login,
    logout: jest.fn(),
    recover: jest.fn(),
    error: '',
    clearError: jest.fn(),
  });
  return render(<LoginPage />);
}

describe('LoginPage', () => {
  it('valida correo y contraseña antes de enviar', async () => {
    const login = jest.fn();
    renderLogin(null, login);
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByText('Ingresá un correo válido')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('muestra el error genérico para credenciales inválidas', async () => {
    const login = jest.fn().mockRejectedValue(new AuthFlowError('Correo o contraseña incorrectos'));
    renderLogin(null, login);
    fireEvent.change(screen.getByLabelText('Correo electrónico'), {
      target: { value: 'ana@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'incorrecta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos');
  });

  it('bloquea vigiladores de web e inicia en el destino del rol', async () => {
    const login = jest
      .fn()
      .mockRejectedValue(new AuthFlowError('Tu usuario se usa desde la app móvil de Garita'));
    renderLogin(null, login);
    fireEvent.change(screen.getByLabelText('Correo electrónico'), {
      target: { value: 'ana@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tu usuario se usa desde la app móvil de Garita',
    );
    expect(profile.role).toBe('admin');
  });
});
