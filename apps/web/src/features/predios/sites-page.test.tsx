import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient } from '@/test/render';
import { useAuth } from '../auth/auth-context';
import { apiPut } from '@/lib/api-client';
import { SitesPage } from './sites-page';

jest.mock('../auth/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/api-client', () => ({
  apiGet: jest.fn((path: string) => {
    if (path === '/predios')
      return [
        {
          id: 'site-1',
          clientId: 'client-1',
          name: 'Sede',
          address: 'Calle 1',
          latitude: -34,
          longitude: -58,
          status: 'active',
          hasActiveSupervisor: false,
        },
      ];
    if (path === '/clientes') return [{ id: 'client-1', name: 'Cliente' }];
    if (path === '/predios/supervisores-disponibles')
      return [{ id: 'supervisor-1', firstName: 'Ana', lastName: 'Gómez' }];
    if (path === '/predios/site-1/supervisores') return [];
    return [];
  }),
  apiPost: jest.fn(() => Promise.resolve({ id: 'site-2' })),
  apiPatch: jest.fn(() => Promise.resolve({ id: 'site-1' })),
  apiPut: jest.fn(() => Promise.resolve([])),
  ApiError: class ApiError extends Error {
    readonly status: number | undefined;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  },
}));

const profile = (role: 'admin' | 'supervisor') =>
  ({
    user: {
      id: 'user-1',
      firstName: 'Ana',
      lastName: 'Gómez',
      email: 'ana@example.invalid',
      role,
      status: 'active',
      company: { id: 'company-1', name: 'Empresa' },
      allowedChannels: ['web'],
    },
    loading: false,
    error: '',
    login: jest.fn(),
    logout: jest.fn(),
    recover: jest.fn(),
    clearError: jest.fn(),
  }) as ReturnType<typeof useAuth>;

describe('SitesPage', () => {
  it('mantiene los controles de administración ocultos para el supervisor', async () => {
    jest.mocked(useAuth).mockReturnValue(profile('supervisor'));
    renderWithQueryClient(<SitesPage />);
    expect(await screen.findByText('Sede')).toBeInTheDocument();
    expect(screen.getByText('Solo lectura')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar predio' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Supervisores de Sede')).not.toBeInTheDocument();
  });

  it('permite seleccionar y asignar supervisores con el selector múltiple', async () => {
    jest.mocked(useAuth).mockReturnValue(profile('admin'));
    const user = userEvent.setup();
    renderWithQueryClient(<SitesPage />);
    const select = await screen.findByRole('listbox', { name: 'Supervisores de Sede' });
    await waitFor(() => {
      expect(select).not.toBeDisabled();
    });
    await user.selectOptions(select, 'supervisor-1');
    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith(
        '/predios/site-1/supervisores',
        { supervisorIds: ['supervisor-1'] },
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
