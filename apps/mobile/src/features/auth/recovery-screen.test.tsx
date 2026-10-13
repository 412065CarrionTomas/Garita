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
    const recover = jest.fn().mockRejectedValue({ code: 'auth/user-not-found' });
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

it('informa el fallo cuando el envío no pudo realizarse', async () => {
  const recover = jest.fn().mockRejectedValue({ code: 'auth/network-request-failed' });
  useAuthMock.mockReturnValue({
    user: null,
    loading: false,
    login: jest.fn(),
    logout: jest.fn(),
    recover,
    error: '',
  });
  const view = await render(<RecoveryScreen />);
  await fireEvent.changeText(view.getByLabelText('Correo electrónico'), 'persona@example.com');
  await fireEvent.press(view.getByLabelText('Enviar enlace'));
  expect(await view.findByText(/No pudimos enviar el enlace/)).toBeTruthy();
  expect(view.queryByText(/Si el correo está registrado/)).toBeNull();
});
