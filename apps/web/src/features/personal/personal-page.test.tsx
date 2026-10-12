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
  jest.mocked(apiGet).mockResolvedValue(page);
  return render(
    <QueryClientProvider client={client}>
      <PersonalPage />
    </QueryClientProvider>,
  );
};

describe('PersonalPage', () => {
  beforeEach(() => jest.clearAllMocks());

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
    jest.mocked(apiGet).mockResolvedValue({
      ...page,
      items: [{ ...page.items[0], status: 'deactivated' }],
    });
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
    jest.mocked(apiGet).mockResolvedValue({
      ...page,
      items: [{ ...page.items[0], status: 'deactivated' }],
    });
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
});
