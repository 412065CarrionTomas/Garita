import { fireEvent, render } from '@testing-library/react-native';
import { useAuth } from './auth-context';
import { RecoveryScreen } from './recovery-screen';

jest.mock('./auth-context', () => ({
  useAuth: jest.fn(),
  RESET_MESSAGE:
    'Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña',
}));
const useAuthMock = jest.mocked(useAuth);

it.each(['registrado@example.com', 'ausente@example.com'])(
  'muestra el mismo resultado para %s',
  async (email) => {
    const recover = jest.fn().mockRejectedValue(new Error('No revelar existencia'));
    useAuthMock.mockReturnValue({
      user: null,
      loading: false,
      login: jest.fn(),
      logout: jest.fn(),
      recover,
      error: '',
    });
    const view = await render(<RecoveryScreen />);
    await fireEvent.changeText(view.getByLabelText('Correo electrónico'), email);
    await fireEvent.press(view.getByLabelText('Enviar enlace'));
    expect(
      await view.findByText(
        'Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña',
      ),
    ).toBeTruthy();
    expect(view.getByText('Revisá también la carpeta de spam.')).toBeTruthy();
  },
);
