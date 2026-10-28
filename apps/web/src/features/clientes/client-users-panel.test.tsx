import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient } from '@/test/render';
import { apiGet, apiPost } from '@/lib/api-client';
import { ClientUsersPanel } from './client-users-panel';

jest.mock('@/lib/api-client', () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(),
  ApiError: class extends Error {},
}));
const person = {
  id: 'user-1',
  clientId: 'client-1',
  firstName: 'Marta',
  lastName: 'Ruiz',
  email: 'marta@example.invalid',
  position: 'Jefa',
  status: 'invitation_pending',
  role: 'client',
  phone: null,
  employeeNumber: null,
  invitationStatus: 'sent',
  lastLoginAt: null,
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(apiGet).mockResolvedValue([person]);
  jest.mocked(apiPost).mockResolvedValue(person);
});

it('muestra estado con texto, cargo y ultimo ingreso; valida los campos antes del alta', async () => {
  const user = userEvent.setup();
  renderWithQueryClient(<ClientUsersPanel clientId="client-1" active />);
  expect(await screen.findByText('Marta Ruiz')).toBeInTheDocument();
  expect(screen.getByText('Invitación pendiente')).toBeInTheDocument();
  expect(screen.getByText('Jefa')).toBeInTheDocument();
  expect(screen.getByText('Sin ingresos')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Dar acceso' }));
  fireEvent.submit(screen.getByRole('form', { name: 'Alta de usuario de cliente' }));
  expect(screen.getByLabelText('Nombre')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Nombre')).toHaveAttribute(
    'aria-describedby',
    'portal-firstName-error',
  );
  expect(screen.getAllByRole('alert')).toHaveLength(3);
  expect(apiPost).not.toHaveBeenCalled();
  for (const [label, value] of [
    ['Nombre', 'Ana'],
    ['Apellido', 'Perez'],
    ['Correo', 'ana@example.invalid'],
    ['Cargo (opcional)', 'Gerente'],
  ])
    fireEvent.change(screen.getByLabelText(label ?? ''), { target: { value } });
  await user.click(screen.getByRole('button', { name: 'Enviar invitación' }));
  await waitFor(() => {
    expect(apiPost).toHaveBeenCalledWith(
      '/clientes/client-1/usuarios',
      { firstName: 'Ana', lastName: 'Perez', email: 'ana@example.invalid', position: 'Gerente' },
      expect.anything(),
      expect.anything(),
    );
  });
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

it.each([
  ['invitation_pending', 'Desactivar', 'desactivar'],
  ['deactivated', 'Reactivar', 'reactivar'],
  ['invitation_pending', 'Reenviar invitación', 'reenviar-invitacion'],
] as const)('confirma la accion %s %s y actualiza el listado', async (status, label, path) => {
  jest.mocked(apiGet).mockResolvedValue([{ ...person, status }]);
  const user = userEvent.setup();
  renderWithQueryClient(<ClientUsersPanel clientId="client-1" active />);
  await user.click(await screen.findByRole('button', { name: label }));
  const dialog = screen.getByRole('alertdialog');
  expect(dialog).toHaveTextContent('Marta Ruiz');
  await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
  expect(apiPost).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: label }));
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }),
  );
  await waitFor(() => {
    expect(apiPost).toHaveBeenCalledWith(
      `/usuarios/user-1/${path}`,
      {},
      expect.anything(),
      expect.anything(),
    );
  });
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
  expect(apiGet).toHaveBeenCalledTimes(2);
});

it('muestra error de envio, fecha de ingreso y fallo de accion sin cerrar la confirmacion', async () => {
  jest
    .mocked(apiGet)
    .mockResolvedValue([
      { ...person, invitationStatus: 'failed', lastLoginAt: '2026-10-19T12:00:00Z' },
    ]);
  jest.mocked(apiPost).mockRejectedValue(new Error('No se pudo guardar'));
  const user = userEvent.setup();
  renderWithQueryClient(<ClientUsersPanel clientId="client-1" active />);
  expect(await screen.findByText('Envío fallido')).toBeInTheDocument();
  expect(screen.queryByText('Sin ingresos')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Reenviar invitación' }));
  await user.click(screen.getByRole('button', { name: 'Confirmar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar');
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
});

it('cliente inactivo no permite altas ni reactivar; soporta listado vacio y error', async () => {
  jest.mocked(apiGet).mockResolvedValue([{ ...person, status: 'deactivated' }]);
  renderWithQueryClient(<ClientUsersPanel clientId="client-1" active={false} />);
  expect(screen.getByRole('button', { name: 'Dar acceso' })).toBeDisabled();
  expect(await screen.findByRole('button', { name: 'Reactivar' })).toBeDisabled();
});

it('muestra el error del alta sin perder el formulario', async () => {
  jest.mocked(apiPost).mockRejectedValue(new Error('Correo en uso'));
  const user = userEvent.setup();
  renderWithQueryClient(<ClientUsersPanel clientId="client-1" active />);
  await user.click(screen.getByRole('button', { name: 'Dar acceso' }));
  for (const [label, value] of [
    ['Nombre', 'Ana'],
    ['Apellido', 'Perez'],
    ['Correo', 'ana@example.invalid'],
  ])
    fireEvent.change(screen.getByLabelText(label ?? ''), { target: { value } });
  await user.click(screen.getByRole('button', { name: 'Enviar invitación' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Correo en uso');
  expect(screen.getByLabelText('Correo')).toHaveValue('ana@example.invalid');
});
