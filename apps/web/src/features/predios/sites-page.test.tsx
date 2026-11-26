import type { ReactNode } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient } from '@/test/render';
import { useAuth } from '../auth/auth-context';
import { apiGet, apiPut, apiPatch, apiPost } from '@/lib/api-client';
import { SitesPage } from './sites-page';

jest.mock('../auth/auth-context', () => ({ useAuth: jest.fn() }));
// Mapa caído: el formulario muestra la carga manual de coordenadas.
jest.mock('@/features/mapa/site-location-map', () => ({
  SiteMapLocation: ({ unavailable }: { unavailable: ReactNode }) => unavailable,
}));
jest.mock('@/lib/api-client', () => ({
  apiGet: jest.fn((path: string) => {
    if (path.endsWith('/impacto-baja'))
      return Promise.resolve({
        shiftsToCancel: 3,
        weeklySchedulesToEnd: 2,
        inProgressShiftsToClose: 1,
        shifts: [
          { id: 'shift-1', startsAt: '2026-10-20T10:00:00Z', endsAt: '2026-10-20T18:00:00Z' },
        ],
      });
    if (path === '/predios')
      return [
        {
          id: 'site-1',
          clientId: 'client-1',
          client: { id: 'client-1', name: 'Cliente desde predio' },
          name: 'Sede',
          address: 'Calle 1',
          latitude: -34,
          longitude: -58,
          status: 'active',
          hasActiveSupervisor: false,
          supervisors: [{ user: { id: 'supervisor-1' } }],
        },
      ];
    if (path.startsWith('/clientes?estado=active&porPagina=50&pagina='))
      return { items: [{ id: 'client-1', name: 'Cliente' }], paginas: 1 };
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
    acceptLegal: jest.fn(),
    clearError: jest.fn(),
  }) as ReturnType<typeof useAuth>;

describe('SitesPage', () => {
  it('abre el alta en un diálogo, conserva los campos y permite cancelar', async () => {
    jest.mocked(useAuth).mockReturnValue(profile('admin'));
    const user = userEvent.setup();
    renderWithQueryClient(<SitesPage />);
    expect(screen.queryByRole('button', { name: 'Guardar predio' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Nuevo predio' }));
    const dialog = screen.getByRole('dialog', { name: 'Alta de predio' });
    expect(within(dialog).getByLabelText('Cliente')).toBeRequired();
    expect(within(dialog).getByLabelText('Nombre')).toBeRequired();
    expect(within(dialog).getByLabelText('Dirección')).toBeRequired();
    expect(await within(dialog).findByLabelText('Latitud')).toBeRequired();
    expect(within(dialog).getByLabelText('Longitud')).toBeRequired();
    expect(within(dialog).getByLabelText('Instrucciones de acceso')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Observaciones')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo predio' })).toHaveFocus();
  });

  it('mantiene los controles de administración ocultos para el supervisor', async () => {
    jest.mocked(useAuth).mockReturnValue(profile('supervisor'));
    renderWithQueryClient(<SitesPage />);
    expect(await screen.findByRole('heading', { name: 'Sede' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo predio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar predio' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Configuración' }));
    expect(screen.queryByRole('group', { name: 'Supervisores asignados' })).not.toBeInTheDocument();
  });

  it('pliega la lista al elegir un predio y la vuelve a mostrar con la flecha', async () => {
    jest.mocked(useAuth).mockReturnValue(profile('admin'));
    const user = userEvent.setup();
    renderWithQueryClient(<SitesPage />);
    await user.click(await screen.findByRole('button', { name: /^Sede/ }));
    expect(screen.queryByRole('navigation', { name: 'Lista de predios' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo predio' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mostrar lista de predios' }));
    expect(screen.getByRole('navigation', { name: 'Lista de predios' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo predio' })).toBeInTheDocument();
  });

  it('asigna y quita supervisores desde la pestaña Configuración', async () => {
    jest.mocked(useAuth).mockReturnValue(profile('admin'));
    const user = userEvent.setup();
    renderWithQueryClient(<SitesPage />);
    await user.click(await screen.findByRole('tab', { name: 'Configuración' }));
    const ana = await screen.findByRole('checkbox', { name: 'Ana Gómez' });
    expect(ana).toBeChecked();
    await user.click(ana);
    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith(
        '/predios/site-1/supervisores',
        { supervisorIds: [] },
        expect.anything(),
        expect.anything(),
      );
    });
  });

  it('carga una sola vez el listado y toma de ahí las asignaciones', async () => {
    jest.mocked(useAuth).mockReturnValue(profile('admin'));
    jest.mocked(apiGet).mockClear();
    renderWithQueryClient(<SitesPage />);
    await screen.findByRole('heading', { name: 'Sede' });
    expect(jest.mocked(apiGet).mock.calls.filter(([path]) => path === '/predios')).toHaveLength(1);
    expect(jest.mocked(apiGet).mock.calls.map(([path]) => path)).not.toContain(
      '/predios/site-1/supervisores',
    );
  });

  it('abre el formulario completo, guarda y permite cancelar o cerrar con Escape', async () => {
    jest.mocked(useAuth).mockReturnValue(profile('admin'));
    const user = userEvent.setup();
    renderWithQueryClient(<SitesPage />);
    await user.click(await screen.findByRole('tab', { name: 'Configuración' }));
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
    await user.click(await screen.findByRole('tab', { name: 'Configuración' }));
    await user.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Dar de baja el predio' });
    expect(dialog).toHaveTextContent('Se cancelarán 3 turnos');
    expect(
      within(dialog).getByRole('list', { name: 'Turnos que se cancelarán' }).children,
    ).toHaveLength(1);
    expect(dialog).toHaveTextContent('terminarán 2 programaciones semanales');
    expect(dialog).toHaveTextContent('se cerrarán 1 turnos en curso');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('envía la confirmación después de mostrar el impacto de la baja', async () => {
    jest.mocked(useAuth).mockReturnValue(profile('admin'));
    const user = userEvent.setup();
    renderWithQueryClient(<SitesPage />);
    await user.click(await screen.findByRole('tab', { name: 'Configuración' }));
    await user.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    expect(await screen.findByText(/Se cancelarán 3 turnos/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirmar baja' }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/predios/site-1/baja',
        { confirm: true },
        expect.anything(),
        expect.anything(),
      );
    });
  });

  it('permite configurar la velocidad máxima de recorrido con etiqueta accesible y teclado', async () => {
    jest.mocked(useAuth).mockReturnValue(profile('admin'));
    const user = userEvent.setup();
    renderWithQueryClient(<SitesPage />);
    await user.click(await screen.findByRole('tab', { name: 'Configuración' }));

    expect(await screen.findByText('Velocidad máxima de recorrido')).toBeInTheDocument();
    const select = screen.getByRole('combobox', {
      name: 'Velocidad máxima de recorrido para Sede',
    });
    expect(select).toBeInTheDocument();

    // Select bicycle profile
    await user.selectOptions(select, 'bicycle');
    await user.click(screen.getByRole('button', { name: 'Guardar velocidad' }));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        '/predios/site-1/recorrido',
        { maxSpeedProfile: 'bicycle' },
        expect.anything(),
        expect.anything(),
      );
    });

    // Select custom profile and enter km/h
    await user.selectOptions(select, 'custom');
    const kmhInput = screen.getByRole('spinbutton', {
      name: 'Velocidad personalizada en km/h para Sede',
    });
    expect(kmhInput).toBeInTheDocument();
    await user.clear(kmhInput);
    await user.type(kmhInput, '45');
    await user.click(screen.getByRole('button', { name: 'Guardar velocidad' }));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        '/predios/site-1/recorrido',
        { maxSpeedProfile: 'custom', maxSpeedKmh: 45 },
        expect.anything(),
        expect.anything(),
      );
    });
  });

  it('permite a un supervisor asignado configurar la velocidad del predio', async () => {
    const supervisorProfile = profile('supervisor');
    if (supervisorProfile.user) {
      supervisorProfile.user.id = 'supervisor-1';
    }
    jest.mocked(useAuth).mockReturnValue(supervisorProfile);
    const user = userEvent.setup();
    renderWithQueryClient(<SitesPage />);
    await user.click(await screen.findByRole('tab', { name: 'Configuración' }));

    const select = await screen.findByRole('combobox', {
      name: 'Velocidad máxima de recorrido para Sede',
    });
    expect(select).toBeInTheDocument();
    await user.selectOptions(select, 'vehicle');
    await user.click(screen.getByRole('button', { name: 'Guardar velocidad' }));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        '/predios/site-1/recorrido',
        { maxSpeedProfile: 'vehicle' },
        expect.anything(),
        expect.anything(),
      );
    });
  });
});

it('trae todas las paginas de clientes activos y muestra el cliente incluido en el predio', async () => {
  jest.mocked(useAuth).mockReturnValue(profile('admin'));
  const original = jest.mocked(apiGet).getMockImplementation();
  jest.mocked(apiGet).mockImplementation(((path: string, schema: unknown) => {
    if (path === '/clientes?estado=active&porPagina=50&pagina=1')
      return Promise.resolve({
        items: Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, name: `Cliente ${i}` })),
        paginas: 2,
      });
    if (path === '/clientes?estado=active&porPagina=50&pagina=2')
      return Promise.resolve({ items: [{ id: 'last', name: 'Ultimo cliente' }], paginas: 2 });
    return original?.(path, schema as never);
  }) as typeof apiGet);
  try {
    const user = userEvent.setup();
    renderWithQueryClient(<SitesPage />);
    expect(await screen.findByText('Cliente: Cliente desde predio')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nuevo predio' }));
    expect(await screen.findByRole('option', { name: 'Ultimo cliente' })).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith(
      '/clientes?estado=active&porPagina=50&pagina=2',
      expect.anything(),
    );
  } finally {
    jest.mocked(apiGet).mockImplementation(original);
  }
});
it('no guarda en cero y limpia el formulario despues del alta', async () => {
  jest.mocked(useAuth).mockReturnValue(profile('admin'));
  jest.mocked(apiPost).mockClear();
  const user = userEvent.setup();
  renderWithQueryClient(<SitesPage />);
  await user.click(await screen.findByRole('button', { name: 'Nuevo predio' }));
  const dialog = screen.getByRole('dialog', { name: 'Alta de predio' });
  await user.selectOptions(await within(dialog).findByLabelText('Cliente'), 'client-1');
  await user.type(within(dialog).getByLabelText('Nombre'), 'Nuevo');
  await user.type(within(dialog).getByLabelText('Dirección'), 'Calle');
  await user.click(within(dialog).getByRole('button', { name: 'Guardar predio' }));
  expect(await screen.findByText('Ubicá el predio antes de guardar')).toBeInTheDocument();
  expect(apiPost).not.toHaveBeenCalled();
  await user.clear(within(dialog).getByLabelText('Latitud'));
  await user.type(within(dialog).getByLabelText('Latitud'), '-34');
  await user.click(within(dialog).getByRole('button', { name: 'Guardar predio' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  await user.click(screen.getByRole('button', { name: 'Nuevo predio' }));
  expect(screen.getByLabelText('Nombre')).toHaveValue('');
  expect(screen.getByLabelText('Dirección')).toHaveValue('');
});
