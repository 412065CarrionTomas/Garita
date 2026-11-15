import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';
import { PersonalPage } from './personal-page';

jest.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {
    status: number | undefined;
    body: unknown;
    constructor(message: string, status?: number, body?: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
  apiGet: jest.fn(),
  apiPatch: jest.fn(),
  apiPost: jest.fn(),
}));
jest.mock('../auth/auth-context', () => ({ useAuth: jest.fn() }));

const page = {
  pagina: 1,
  total: 1,
  paginas: 1,
  items: [
    {
      id: 'u1',
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ana@example.com',
      phone: '+5491112345678',
      employeeNumber: '10',
      role: 'guard',
      status: 'active',
      invitationStatus: null,
    },
  ],
};
let futureShiftRows: unknown[] = [];
let inProgressShiftMock: unknown = null;
let listedStatus = 'active';
const input = (name: string): HTMLInputElement => {
  const element = document.querySelector(`input[name=${name}]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input ${name}`);
  return element;
};

const setup = (role = 'admin') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  jest
    .mocked(useAuth)
    .mockReturnValue({ user: { role }, loading: false } as ReturnType<typeof useAuth>);
  jest.mocked(apiGet).mockImplementation((path: string) =>
    path.startsWith('/turnos/')
      ? Promise.resolve(inProgressShiftMock as never)
      : path.endsWith('/turnos-futuros')
        ? Promise.resolve(futureShiftRows as never)
        : path.includes('rol=guard')
          ? Promise.resolve({
              ...page,
              items: [
                ...page.items,
                {
                  ...page.items[0],
                  id: 'u2',
                  firstName: 'Juan',
                  lastName: 'Pérez',
                  status: 'invitation_pending',
                },
              ],
            })
          : Promise.resolve({ ...page, items: [{ ...page.items[0], status: listedStatus }] }),
  );
  return render(
    <QueryClientProvider client={client}>
      <PersonalPage />
    </QueryClientProvider>,
  );
};

describe('PersonalPage', () => {
  beforeEach(() => {
    futureShiftRows = [];
    inProgressShiftMock = null;
    listedStatus = 'active';
    jest.clearAllMocks();
    jest.mocked(apiPost).mockResolvedValue({ ok: true });
  });

  it('accepts the personnel detail returned when resending an invitation', async () => {
    listedStatus = 'invitation_pending';
    setup();
    jest
      .mocked(apiPost)
      .mockImplementation((_path, _body, _request, response) =>
        Promise.resolve(response.parse({ ...page.items[0], status: 'invitation_pending' })),
      );
    await userEvent.click(await screen.findByRole('button', { name: 'Acciones' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reenviar invitación' }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalled();
    });
    expect(screen.queryByText('No se pudo reenviar la invitación.')).not.toBeInTheDocument();
  });

  it('lista, pagina y filtra personal por rol y estado', async () => {
    setup();
    expect(await screen.findByText(/Ana Pérez/)).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Filtrar por rol' })).getByRole('button', {
        name: 'Supervisores',
      }),
    );
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por estado'), 'active');
    await waitFor(() => {
      expect(apiGet).toHaveBeenLastCalledWith(
        expect.stringContaining('rol=supervisor'),
        expect.anything(),
      );
    });
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });

  it('oculta acciones a supervisores', async () => {
    setup('supervisor');
    await screen.findByText(/Ana Pérez/);
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument();
  });

  it('abre y cancela el alta sin enviar una invitación', async () => {
    setup();
    expect(screen.queryByRole('form', { name: 'Invitar usuario' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Invitar usuario' }));
    const dialog = screen.getByRole('dialog', { name: 'Invitar usuario' });
    expect(within(dialog).getByRole('form', { name: 'Invitar usuario' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Rol')).toHaveValue('guard');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('edita los mismos campos dentro del diálogo y guarda el registro', async () => {
    jest.mocked(apiPatch).mockResolvedValue(page.items[0]);
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar personal' });
    expect(dialog).toHaveAttribute('aria-labelledby', 'edit-title');
    expect(dialog).toHaveAttribute('aria-describedby', expect.stringContaining('edit-description'));
    const name = within(dialog).getByLabelText('Nombre');
    expect(name).toHaveValue('Ana');
    await userEvent.clear(name);
    await userEvent.type(name, 'Ana María');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        '/usuarios/u1',
        {
          firstName: 'Ana María',
          lastName: 'Pérez',
          phone: '+5491112345678',
          employeeNumber: '10',
        },
        expect.anything(),
        expect.anything(),
      );
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('conserva las tres acciones de invitación pendiente en el menú', async () => {
    listedStatus = 'invitation_pending';
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Acciones' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Editar' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Desactivar' })).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Reenviar invitación' }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/usuarios/u1/reenviar-invitacion',
        {},
        expect.anything(),
        expect.anything(),
      );
    });
  });

  it.each(['light', 'dark'])('usa estados y clases semánticas en tema %s', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      setup();
      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(
        within(screen.getByRole('table')).getByText('Activo').closest('[data-slot="badge"]'),
      ).toHaveAttribute('data-variant', 'normal');
      const section = screen.getByRole('region', { name: 'Personal' });
      expect(section.querySelector('[data-slot="table-container"]')).toHaveClass('overflow-x-auto');
      for (const element of section.querySelectorAll('[class]')) {
        expect(element.getAttribute('class')).not.toMatch(
          /(?:bg|text|border)-(?:red|amber|gray|white|black)(?:-|\b)/,
        );
      }
    } finally {
      document.documentElement.classList.remove('dark');
    }
  });

  it('muestra el estado vacío y permite abrir el alta', async () => {
    jest.mocked(apiGet).mockResolvedValueOnce({ ...page, items: [] });
    setup();
    expect(await screen.findByText('No hay personal para mostrar')).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole('banner')).getByRole('button', { name: 'Invitar usuario' }),
    );
    expect(screen.getByRole('dialog', { name: 'Invitar usuario' })).toBeInTheDocument();
  });

  it('anuncia la carga con esqueletos y el error con una alerta', async () => {
    jest.mocked(apiGet).mockImplementationOnce(
      () =>
        new Promise(() => {
          /* Keep the request pending while checking the loading state. */
        }),
    );
    const view = setup();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando personal…');
    expect(screen.getByRole('status').querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4);
    view.unmount();
    jest.mocked(apiGet).mockRejectedValueOnce(new Error('Sin conexión'));
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el personal.');
  });

  it('muestra errores de validación por campo y el 409 en el formulario', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Invitar usuario' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar invitación' }));
    expect((await screen.findAllByText(/expected string to have/)).length).toBeGreaterThan(0);
    expect(input('firstName')).toHaveAttribute('aria-invalid', 'true');
    jest.mocked(apiPost).mockRejectedValueOnce(new ApiError('conflicto', 409));
    await userEvent.type(input('firstName'), 'Ana');
    await userEvent.type(input('lastName'), 'Pérez');
    await userEvent.type(input('email'), 'ana@example.com');
    await userEvent.type(input('phone'), '+5491112345678');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar invitación' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ese correo ya está en uso');
  });

  it('confirma o cancela la desactivación y permite reactivar y reenviar', async () => {
    setup();
    await screen.findByText(/Ana Pérez/);
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    expect(screen.getByRole('dialog', { name: 'Desactivar usuario' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(apiPost).not.toHaveBeenCalled();
    listedStatus = 'deactivated';
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar desactivación' }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/usuarios/u1/desactivar',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
    listedStatus = 'deactivated';
    await userEvent.click(screen.getByRole('button', { name: 'Reactivar' }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/usuarios/u1/reactivar',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  it('lista turnos, deriva los compatibles y muestra los que chocan', async () => {
    futureShiftRows = [
      {
        id: 'shift-1',
        startsAt: '2030-10-14T12:00:00.000Z',
        endsAt: '2030-10-14T20:00:00.000Z',
        site: { name: 'Predio A' },
      },
      {
        id: 'shift-2',
        startsAt: '2030-10-15T12:00:00.000Z',
        endsAt: '2030-10-15T20:00:00.000Z',
        site: { name: 'Predio B' },
      },
    ];
    jest.mocked(apiPost).mockResolvedValue({
      ok: true,
      derivedCount: 1,
      unassignedCount: 0,
      notDerived: [{ id: 'shift-2', site: { name: 'Predio B' } }],
    });
    setup();
    await screen.findByText(/Ana Pérez/);
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    expect(await screen.findByText('Tiene 2 turnos futuros:')).toBeInTheDocument();
    expect(screen.getByText(/Predio A/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Derivar turnos a'), 'u2');
    await userEvent.click(screen.getByRole('button', { name: 'Derivar y desactivar' }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/usuarios/u1/desactivar',
        { deriveToUserId: 'u2' },
        expect.anything(),
        expect.anything(),
      );
    });
    expect(await screen.findByText(/1 turnos no se pudieron derivar/)).toBeInTheDocument();
    expect(screen.getByText('Predio B')).toBeInTheDocument();
  });

  it('pide una segunda confirmación con la cantidad de turnos sin vigilador', async () => {
    futureShiftRows = [
      {
        id: 'shift-1',
        startsAt: '2030-10-14T12:00:00.000Z',
        endsAt: '2030-10-14T20:00:00.000Z',
        site: { name: 'Predio A' },
      },
    ];
    jest.mocked(apiPost).mockResolvedValue({
      ok: true,
      derivedCount: 0,
      unassignedCount: 1,
      notDerived: [],
    });
    setup();
    await screen.findByText(/Ana Pérez/);
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    await screen.findByText('Tiene 1 turnos futuros:');
    await userEvent.click(screen.getByLabelText('Dejar los turnos sin vigilador'));
    expect(screen.getByRole('alert')).toHaveTextContent('1 turnos quedarán sin vigilador');
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirmar que 1 turnos quedan sin vigilador' }),
    );
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/usuarios/u1/desactivar',
        { leaveUnassigned: true, confirmUnassignedCount: 1 },
        expect.anything(),
        expect.anything(),
      );
    });
  });

  it('cuando 409 tiene turno en curso muestra el turno, advertencia y Desactivar igual; valida motivo y envía con forceDeactivate', async () => {
    const shiftInProgress = {
      id: 'shift-in-progress-1',
      startsAt: '2026-10-14T10:00:00.000Z',
      endsAt: '2026-10-14T18:00:00.000Z',
      site: {
        name: 'Predio Central',
        company: { timezone: 'America/Argentina/Buenos_Aires' },
      },
    };
    inProgressShiftMock = shiftInProgress;
    jest.mocked(apiPost).mockRejectedValueOnce(
      new ApiError('Turno en curso', 409, {
        code: 'GUARD_HAS_SHIFT_IN_PROGRESS',
        shiftId: 'shift-in-progress-1',
        shift: shiftInProgress,
      }),
    );

    setup();
    await screen.findByText(/Ana Pérez/);
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar desactivación' }));

    // 1. Muestra el turno en curso con predio, inicio y fin en hora local
    expect(await screen.findByText(/Turno en curso:/)).toBeInTheDocument();
    expect(screen.getByText(/Predio Central/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /El turno se cerrará ahora como un cierre antes de hora del administrador y quedará sin cobertura/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desactivar igual' })).toBeInTheDocument();

    // 2. Sin motivo (o menor a 3 caracteres) no envía
    const reasonInput = screen.getByLabelText(/Motivo de desactivación/i);
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar igual' }));
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(reasonInput).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText('El motivo es obligatorio y debe tener al menos 3 caracteres.'),
    ).toBeInTheDocument();

    await userEvent.type(reasonInput, 'ab');
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar igual' }));
    expect(apiPost).toHaveBeenCalledTimes(1);

    // 3. Con motivo válido reenvía con forceDeactivate y reason
    jest.mocked(apiPost).mockResolvedValueOnce({ ok: true });
    await userEvent.clear(reasonInput);
    await userEvent.type(reasonInput, 'Celular robado durante guardia');
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar igual' }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/usuarios/u1/desactivar',
        { forceDeactivate: true, reason: 'Celular robado durante guardia' },
        expect.anything(),
        expect.anything(),
      );
    });
  });

  it('combina Desactivar igual con derivación de turnos futuros', async () => {
    futureShiftRows = [
      {
        id: 'shift-future-1',
        startsAt: '2030-10-15T12:00:00.000Z',
        endsAt: '2030-10-15T20:00:00.000Z',
        site: { name: 'Predio Futuro' },
      },
    ];
    inProgressShiftMock = {
      id: 'shift-in-progress-2',
      startsAt: '2026-10-14T08:00:00.000Z',
      endsAt: '2026-10-14T16:00:00.000Z',
      site: {
        name: 'Predio Ruta 9',
        company: { timezone: 'America/Argentina/Buenos_Aires' },
      },
    };
    jest.mocked(apiPost).mockRejectedValueOnce(
      new ApiError('Turno en curso', 409, {
        code: 'GUARD_HAS_SHIFT_IN_PROGRESS',
        shiftId: 'shift-in-progress-2',
      }),
    );

    setup();
    await screen.findByText(/Ana Pérez/);
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    expect(await screen.findByText('Tiene 1 turnos futuros:')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Derivar turnos a'), 'u2');
    await userEvent.click(screen.getByRole('button', { name: 'Derivar y desactivar' }));

    // Responde 409 y muestra el turno en curso (obtenido por apiGet /turnos/shift-in-progress-2)
    expect(await screen.findByText(/Predio Ruta 9/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desactivar igual' })).toBeInTheDocument();

    jest.mocked(apiPost).mockResolvedValueOnce({
      ok: true,
      derivedCount: 1,
      unassignedCount: 0,
      notDerived: [],
    });
    const reasonInput = screen.getByLabelText(/Motivo de desactivación/i);
    await userEvent.type(reasonInput, 'Despido en plena guardia');
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar igual' }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/usuarios/u1/desactivar',
        {
          forceDeactivate: true,
          reason: 'Despido en plena guardia',
          deriveToUserId: 'u2',
        },
        expect.anything(),
        expect.anything(),
      );
    });
  });

  it('combina Desactivar igual con confirmación de dejar turnos sin vigilador', async () => {
    futureShiftRows = [
      {
        id: 'shift-future-1',
        startsAt: '2030-10-15T12:00:00.000Z',
        endsAt: '2030-10-15T20:00:00.000Z',
        site: { name: 'Predio Futuro' },
      },
      {
        id: 'shift-future-2',
        startsAt: '2030-10-16T12:00:00.000Z',
        endsAt: '2030-10-16T20:00:00.000Z',
        site: { name: 'Predio Futuro 2' },
      },
    ];
    const shiftInProgress = {
      id: 'shift-in-progress-3',
      startsAt: '2026-10-14T06:00:00.000Z',
      endsAt: '2026-10-14T14:00:00.000Z',
      site: {
        name: 'Planta Industrial',
        company: { timezone: 'America/Argentina/Buenos_Aires' },
      },
    };
    inProgressShiftMock = shiftInProgress;
    jest.mocked(apiPost).mockRejectedValueOnce(
      new ApiError('Turno en curso', 409, {
        code: 'GUARD_HAS_SHIFT_IN_PROGRESS',
        shiftId: 'shift-in-progress-3',
        shift: shiftInProgress,
      }),
    );

    setup();
    await screen.findByText(/Ana Pérez/);
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    await screen.findByText('Tiene 2 turnos futuros:');
    await userEvent.click(screen.getByLabelText('Dejar los turnos sin vigilador'));
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirmar que 2 turnos quedan sin vigilador' }),
    );

    expect(await screen.findByText(/Planta Industrial/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desactivar igual' })).toBeInTheDocument();

    jest.mocked(apiPost).mockResolvedValueOnce({
      ok: true,
      derivedCount: 0,
      unassignedCount: 2,
      notDerived: [],
    });
    const reasonInput = screen.getByLabelText(/Motivo de desactivación/i);
    await userEvent.type(reasonInput, 'Abandono de guardia imprevisto');
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar igual' }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/usuarios/u1/desactivar',
        {
          forceDeactivate: true,
          reason: 'Abandono de guardia imprevisto',
          leaveUnassigned: true,
          confirmUnassignedCount: 2,
        },
        expect.anything(),
        expect.anything(),
      );
    });
  });
});

describe('HU-41 mensajes del cupo', () => {
  it.each([
    ['trial', 'Suscribirme'],
    ['active', 'Cambiar de plan'],
  ])('reactivación con cuenta %s muestra mensaje del servidor y %s', async (status, link) => {
    listedStatus = 'deactivated';
    setup();
    jest.mocked(apiPost).mockRejectedValue(
      new ApiError('Conflicto', 409, {
        code: 'guard_limit_reached',
        status,
        message: 'Alcanzaste el límite de vigiladores.',
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Reactivar' }));
    expect(await screen.findByText('Alcanzaste el límite de vigiladores.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: link })).toHaveAttribute('href', '/suscripcion');
  });
  it('alta con cupo completo no confunde el error con correo duplicado', async () => {
    setup();
    jest.mocked(apiPost).mockRejectedValue(
      new ApiError('Conflicto', 409, {
        code: 'guard_limit_reached',
        status: 'trial',
        message: 'Alcanzaste el límite de vigiladores de la prueba.',
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Invitar usuario' }));
    const form = screen.getByRole('form', { name: 'Invitar usuario' });
    fireEvent.change(within(form).getByLabelText('Nombre'), { target: { value: 'Ana' } });
    fireEvent.change(within(form).getByLabelText('Apellido'), { target: { value: 'Prueba' } });
    fireEvent.change(within(form).getByLabelText('Correo'), {
      target: { value: 'ana@example.invalid' },
    });
    fireEvent.change(within(form).getByLabelText('Teléfono celular'), {
      target: { value: '+5491123456789' },
    });
    fireEvent.submit(form);
    expect(
      await screen.findByText('Alcanzaste el límite de vigiladores de la prueba.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Suscribirme' })).toHaveAttribute(
      'href',
      '/suscripcion',
    );
  });
});
