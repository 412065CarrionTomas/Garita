import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient } from '@/test/render';
import { apiGet, apiPost } from '@/lib/api-client';
import { ClientsPage } from './clients-page';

jest.mock('@/lib/api-client', () => {
  class ApiError extends Error {
    readonly status: number | undefined;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    apiGet: jest.fn((path: string) =>
      path.endsWith('/impacto-baja')
        ? Promise.resolve({
            shiftsToCancel: 4,
            weeklySchedulesToEnd: 1,
            inProgressShiftsToClose: 2,
            shifts: [
              { id: 'shift-1', startsAt: '2026-10-20T10:00:00Z', endsAt: '2026-10-20T18:00:00Z' },
            ],
          })
        : Promise.resolve({
            items: [
              {
                id: 'client-1',
                name: 'Cliente Norte',
                contactName: 'Ana',
                phone: '+541112345678',
                email: 'ana@example.invalid',
                taxId: null,
                status: path.includes('estado=inactive') ? 'inactive' : 'active',
                _count: { sites: 3 },
              },
            ],
            pagina: 1,
            total: 1,
            paginas: 1,
            resumen: { active: 1, inactive: 2 },
          }),
    ),
    apiPost: jest.fn(() => Promise.reject(new ApiError('HTTP 409', 409))),
    apiPatch: jest.fn(() => Promise.resolve({ id: 'client' })),
    ApiError,
  };
});

const rowAction = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(await screen.findByRole('button', { name: 'Más acciones de Cliente Norte' }));
  await user.click(await screen.findByRole('menuitem', { name }));
};

describe('ClientsPage', () => {
  it('muestra contacto, predios y busca y filtra en el backend sin botón', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<ClientsPage />);
    expect(await screen.findByText('ana@example.invalid')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '3 predios de Cliente Norte' })).toHaveAttribute(
      'href',
      '/clientes/client-1',
    );
    await user.type(screen.getByRole('searchbox', { name: 'Buscar clientes' }), 'norte');
    await waitFor(() => {
      expect(apiGet).toHaveBeenLastCalledWith(
        expect.stringContaining('buscar=norte'),
        expect.anything(),
      );
    });
    const summary = screen.getByRole('group', { name: 'Resumen de clientes' });
    await user.click(within(summary).getByRole('button', { name: /Inactivos/ }));
    await waitFor(() => {
      expect(apiGet).toHaveBeenLastCalledWith(
        expect.stringContaining('estado=inactive'),
        expect.anything(),
      );
    });
    // Un cliente ya dado de baja no ofrece darlo de baja otra vez.
    await user.click(await screen.findByRole('button', { name: 'Más acciones de Cliente Norte' }));
    expect(await screen.findByRole('menuitem', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Dar de baja' })).not.toBeInTheDocument();
  });

  it('abre el alta desde el encabezado y permite cancelar sin enviar', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<ClientsPage />);
    expect(screen.queryByLabelText('Nombre o razón social')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
    expect(screen.getByRole('dialog', { name: 'Nuevo cliente' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo cliente' })).toHaveFocus();
  });

  it('valida los campos obligatorios antes de enviar', async () => {
    renderWithQueryClient(<ClientsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
    fireEvent.change(screen.getByLabelText('Nombre o razón social'), {
      target: { value: 'Cliente' },
    });
    fireEvent.change(screen.getByLabelText('Persona de contacto'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '123' } });
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'correo-inválido' } });
    const form = screen.getByRole('button', { name: 'Registrar cliente' }).closest('form');
    if (!form) throw new Error('No se encontró el formulario de clientes');
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('muestra el conflicto de nombre duplicado enviado por la API', async () => {
    renderWithQueryClient(<ClientsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
    for (const [label, value] of [
      ['Nombre o razón social', 'Cliente'],
      ['Persona de contacto', 'Ana'],
      ['Teléfono', '12345678'],
      ['Correo', 'ana@example.invalid'],
    ] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    const form = screen.getByRole('button', { name: 'Registrar cliente' }).closest('form');
    if (!form) throw new Error('No se encontró el formulario de clientes');
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya existe un cliente con ese nombre',
    );
  });

  it('abre la edición completa y permite validar, guardar, cancelar y cerrar con Escape', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<ClientsPage />);
    await rowAction(user, 'Editar');
    expect(screen.getByRole('dialog', { name: 'Editar cliente' })).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    const email = within(dialog).getByLabelText('Correo');
    await user.clear(email);
    await user.type(email, 'correo-inválido');
    expect(email).toHaveProperty('validity.typeMismatch', true);
    await user.clear(email);
    await user.type(email, 'ana@example.invalid');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await rowAction(user, 'Editar');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('muestra la baja en cascada en una confirmación accesible', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<ClientsPage />);
    await rowAction(user, 'Dar de baja');
    const dialog = screen.getByRole('alertdialog', { name: 'Dar de baja al cliente' });
    expect(dialog).toHaveTextContent('Se cancelarán 4 turnos');
    expect(
      within(dialog).getByRole('list', { name: 'Turnos que se cancelarán' }).children,
    ).toHaveLength(1);
    expect(dialog).toHaveTextContent('terminarán 1 programaciones semanales');
    expect(dialog).toHaveTextContent('se cerrarán 2 turnos en curso');
    await user.click(screen.getByRole('button', { name: 'Confirmar baja' }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/clientes/client-1/baja',
        { confirm: true },
        expect.anything(),
        expect.anything(),
      );
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });
});
