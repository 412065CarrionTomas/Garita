import { render } from '@testing-library/react-native';
import type { AuthMeResponse } from '@garita/shared';
import { useAuth } from '@/features/auth/auth-context';
import ConfigurationHome from './index';

jest.mock('@/features/auth/auth-context', () => ({ useAuth: jest.fn() }));
const useAuthMock = jest.mocked(useAuth);

it.each(['admin', 'supervisor'] as const)('%s solo ve el modo de configuración', async (role) => {
  const user: AuthMeResponse = {
    id: 'u1',
    firstName: 'Ana',
    lastName: 'García',
    email: 'ana@example.com',
    role,
    status: 'active',
    company: { id: 'c1', name: 'Seguridad Norte' },
    allowedChannels: ['web', 'mobile'],
  };
  useAuthMock.mockReturnValue({
    user,
    loading: false,
    login: jest.fn(),
    logout: jest.fn(),
    recover: jest.fn(),
    error: '',
  });
  const view = await render(<ConfigurationHome />);
  expect(view.getByText('Modo de configuración')).toBeTruthy();
  expect(view.queryByText('Mis turnos')).toBeNull();
  expect(view.queryByText('Registrar punto')).toBeNull();
});
