import { fireEvent, render, screen } from '@testing-library/react';
import { RecoveryPage } from './recovery-page';
import { RESET_MESSAGE, useAuth } from './auth-context';

jest.mock('./auth-context', () => ({
  useAuth: jest.fn(),
  RESET_MESSAGE:
    'Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña',
}));
const useAuthMock = jest.mocked(useAuth);

it.each(['correo-existente@example.com', 'inexistente@example.com'])(
  'muestra una respuesta indistinguible para %s',
  async (email) => {
    const recover = jest.fn().mockRejectedValue(new Error('Firebase error is not exposed'));
    useAuthMock.mockReturnValue({
      user: null,
      loading: false,
      login: jest.fn(),
      logout: jest.fn(),
      recover,
      error: '',
      clearError: jest.fn(),
    });
    render(<RecoveryPage />);
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: email } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));
    expect(await screen.findByText(RESET_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText('Revisá también la carpeta de spam.')).toBeInTheDocument();
  },
);
