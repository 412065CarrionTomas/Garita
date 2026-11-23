import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ViewPreferenceInput } from '@garita/shared';
import { apiGet, apiPut } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { createSummaryApi } from '@/test/summary-api';
import { SummaryPage } from './summary-page';

jest.mock('@/lib/api-client', () => {
  const actual: Record<string, unknown> = jest.requireActual('@/lib/api-client');
  return { ApiError: actual.ApiError, apiGet: jest.fn(), apiPut: jest.fn(), apiDelete: jest.fn() };
});
jest.mock('recharts', () => {
  const Empty = () => null;
  return new Proxy({}, { get: () => Empty });
});

const api = createSummaryApi();

beforeEach(() => {
  api.reset();
  jest.mocked(apiGet).mockReset();
  jest.mocked(apiGet).mockImplementation((path: string) => api.respond(path));
  jest.mocked(apiPut).mockReset();
  jest.mocked(apiPut).mockImplementation((_path: string, body: unknown) =>
    Promise.resolve({
      layout: (body as ViewPreferenceInput).layout,
      updatedAt: '2026-11-23T12:00:00.000Z',
    }),
  );
});

async function startEditing() {
  const user = userEvent.setup();
  renderWithQueryClient(<SummaryPage />);
  await user.click(await screen.findByRole('button', { name: 'Editar diseño' }));
  return user;
}
const announcer = () => screen.getByRole('status', { name: 'Cambios del diseño' });

it('redimensiona con el teclado, anuncia cada paso y guarda', async () => {
  const user = await startEditing();
  const handle = screen.getByRole('button', { name: 'Cambiar el tamaño de Cumplimiento' });
  expect(handle).toHaveAccessibleDescription(/Enter o Espacio toma el asa/);
  handle.focus();
  await user.keyboard('{Enter}');
  expect(handle).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() => {
    expect(announcer()).toHaveTextContent(/Cambiando el tamaño de Cumplimiento/);
  });
  await user.keyboard('{ArrowRight}');
  await waitFor(() => {
    expect(announcer()).toHaveTextContent(
      'Cumplimiento: columna 1, fila 55, 66 de ancho y 72 de alto.',
    );
  });
  await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{Enter}');
  await waitFor(() => {
    expect(announcer()).toHaveTextContent(
      'Cumplimiento quedó en columna 1, fila 55, 72 de ancho y 72 de alto.',
    );
  });
  // El foco sigue en el asa: el DOM no se reordena mientras se edita.
  expect(handle).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Guardar diseño' }));
  await waitFor(() => {
    expect(apiPut).toHaveBeenCalledTimes(1);
  });
  const body = jest.mocked(apiPut).mock.calls[0]?.[1] as ViewPreferenceInput;
  expect(body.layout.items.find((item) => item.id === 'compliance')?.w).toBe(72);
});

it('Escape vuelve a como estaba y no deja nada para guardar', async () => {
  const user = await startEditing();
  const handle = screen.getByRole('button', { name: 'Mover Turnos de hoy' });
  handle.focus();
  await user.keyboard('{Enter}{ArrowLeft}{ArrowLeft}{Escape}');
  await waitFor(() => {
    expect(announcer()).toHaveTextContent('Se canceló el cambio de Turnos de hoy.');
  });
  expect(screen.getByRole('button', { name: 'Guardar diseño' })).toBeDisabled();
});

it('todo un movimiento por teclado se deshace de una vez con Ctrl+Z', async () => {
  const user = await startEditing();
  const handle = screen.getByRole('button', { name: 'Mover Turnos de hoy' });
  handle.focus();
  await user.keyboard('{Enter}{ArrowUp}{ArrowLeft}{ArrowLeft}{Enter}');
  expect(screen.getByRole('button', { name: 'Guardar diseño' })).toBeEnabled();
  await user.keyboard('{Control>}z{/Control}');
  expect(screen.getByRole('button', { name: 'Guardar diseño' })).toBeDisabled();
});
