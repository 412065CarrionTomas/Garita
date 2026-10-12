import { fireEvent, render } from '@testing-library/react-native';
import { LoginScreen } from './login-screen';
import { AuthFlowError, useAuth } from './auth-context';
import { router } from 'expo-router';

jest.mock('./auth-context', () => ({
  useAuth: jest.fn(),
  AuthFlowError: class AuthFlowError extends Error {},
}));
const useAuthMock = jest.mocked(useAuth);

describe('LoginScreen', () => {
  it('valida antes de enviar', async () => {
    const login = jest.fn();
    useAuthMock.mockReturnValue({
      user: null,
      loading: false,
      login,
      logout: jest.fn(),
      recover: jest.fn(),
      error: '',
    });
    const view = await render(<LoginScreen />);
    await fireEvent.press(view.getByLabelText('Ingresar'));
    expect(await view.findByText('Ingresá un correo válido')).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
  });

  it('muestra credenciales inválidas', async () => {
    const login = jest.fn().mockRejectedValue(new AuthFlowError('Correo o contraseña incorrectos'));
    useAuthMock.mockReturnValue({
      user: null,
      loading: false,
      login,
      logout: jest.fn(),
      recover: jest.fn(),
      error: '',
    });
    const view = await render(<LoginScreen />);
    await fireEvent.changeText(view.getByLabelText('Correo electrónico'), 'ana@example.com');
    await fireEvent.changeText(view.getByLabelText('Contraseña'), 'mala');
    await fireEvent.press(view.getByLabelText('Ingresar'));
    expect(await view.findByText('Correo o contraseña incorrectos')).toBeTruthy();
  });

  it('redirige administradores al modo de configuración después del ingreso', async () => {
    const profile = {
      id: 'u1',
      firstName: 'Ana',
      lastName: 'García',
      email: 'ana@example.com',
      role: 'admin' as const,
      status: 'active' as const,
      company: { id: 'c1', name: 'Seguridad Norte' },
      allowedChannels: ['web', 'mobile'] as const,
    };
    const login = jest.fn().mockResolvedValue(profile);
    useAuthMock.mockReturnValue({
      user: null,
      loading: false,
      login,
      logout: jest.fn(),
      recover: jest.fn(),
      error: '',
    });
    const replaceMock = jest.mocked(router.replace);
    replaceMock.mockClear();
    const view = await render(<LoginScreen />);
    await fireEvent.changeText(view.getByLabelText('Correo electrónico'), 'ana@example.com');
    await fireEvent.changeText(view.getByLabelText('Contraseña'), 'correcta');
    await fireEvent.press(view.getByLabelText('Ingresar'));
    expect(replaceMock).toHaveBeenCalledWith('/(configuration)');
  });
});
