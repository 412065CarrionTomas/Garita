import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient } from '@/test/render';
import { useAuth } from '../auth/auth-context';
import { apiGet, apiPut, apiPatch, apiPost } from '@/lib/api-client';
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
          supervisors: [{ user: { id: 'supervisor-1' } }],
        },
      ];
    if (path === '/clientes') return [{ id: 'client-1', name: 'Cliente' }];
    if (path === '/predios/supervisores-disponibles')
      return [{ id: 'supervisor-1', firstName: 'Ana', lastName: 'Gómez' }];
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

  it('carga una sola vez el listado y toma de ahí las asignaciones', async () => {
    jest.mocked(useAuth).mockReturnValue(profile('admin'));
    jest.mocked(apiGet).mockClear();
    renderWithQueryClient(<SitesPage />);
    await screen.findByText('Sede');
    expect(jest.mocked(apiGet).mock.calls.filter(([path]) => path === '/predios')).toHaveLength(1);
    expect(jest.mocked(apiGet).mock.calls.map(([path]) => path)).not.toContain(
      '/predios/site-1/supervisores',
    );
  });

  it('abre el formulario completo, guarda y permite cancelar o cerrar con Escape', async () => {
    jest.mocked(useAuth).mockReturnValue(profile('admin'));
    const user = userEvent.setup();
    renderWithQueryClient(<SitesPage />);
    await user.click(await screen.findByRole('button', { name: 'Editar predio' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar predio' });
    expect(dialog).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Nombre'));
    await user.type(within(dialog).getByLabelText('Nombre'), 'Sede nueva');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalled();
    });
    await user.click(await screen.findByRole('button', { name: 'Editar predio' }));
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Editar predio' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('confirma la baja con un diálogo accesible y permite cancelar', async () => {
    jest.mocked(useAuth).mockReturnValue(profile('admin'));
    const user = userEvent.setup();
    renderWithQueryClient(<SitesPage />);
    await user.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    expect(screen.getByRole('alertdialog', { name: 'Dar de baja el predio' })).toHaveTextContent(
      'quitarán las asignaciones',
    );
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
