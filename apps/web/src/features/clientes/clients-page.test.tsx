import { fireEvent, screen } from '@testing-library/react';
import { renderWithQueryClient } from '@/test/render';
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
    apiGet: jest.fn(() => Promise.resolve([])),
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
});
