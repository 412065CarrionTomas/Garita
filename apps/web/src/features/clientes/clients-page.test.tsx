import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient } from '@/test/render';
import { apiPost } from '@/lib/api-client';
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
            shifts: [],
          })
        : Promise.resolve([
            {
              id: 'client-1',
              name: 'Cliente Norte',
              contactName: 'Ana',
              phone: '+541112345678',
              email: 'ana@example.invalid',
              taxId: null,
              status: 'active',
            },
          ]),
    ),
    apiPost: jest.fn(() => Promise.reject(new ApiError('HTTP 409', 409))),
    apiPatch: jest.fn(() => Promise.resolve({ id: 'client' })),
    ApiError,
  };
});

describe('ClientsPage', () => {
  it('valida los campos obligatorios antes de enviar', async () => {
    renderWithQueryClient(<ClientsPage />);
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
    await user.click(await screen.findByRole('button', { name: 'Editar' }));
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
    await user.click(await screen.findByRole('button', { name: 'Editar' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('muestra la baja en cascada en una confirmación accesible', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<ClientsPage />);
    await user.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Dar de baja al cliente' });
    expect(dialog).toHaveTextContent('Se cancelarán 4 turnos');
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
