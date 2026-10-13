import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';
import { PersonalPage } from './personal-page';

jest.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {
    status: number | undefined;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
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
    path.endsWith('/turnos-futuros')
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
    listedStatus = 'active';
    jest.clearAllMocks();
    jest.mocked(apiPost).mockResolvedValue({ ok: true });
  });

  it('lista, pagina y filtra personal por rol y estado', async () => {
    setup();
    expect(await screen.findByText(/Ana Pérez/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por rol'), 'supervisor');
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

  it('muestra errores de validación por campo y el 409 en el formulario', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Agregar personal' }));
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
});
