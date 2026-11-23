import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  adminSummaryCatalog,
  VIEW_PREFERENCE_CONFLICT_CODE,
  type ViewPreferenceInput,
} from '@garita/shared';
import { ApiError, apiDelete, apiGet, apiPut } from '@/lib/api-client';
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
const savedAt = '2026-11-23T12:00:00.000Z';

beforeEach(() => {
  api.reset();
  jest.mocked(apiGet).mockReset();
  jest.mocked(apiGet).mockImplementation((path: string) => api.respond(path));
  jest.mocked(apiPut).mockReset();
  jest
    .mocked(apiPut)
    .mockImplementation((_path: string, body: unknown) =>
      Promise.resolve({ layout: (body as ViewPreferenceInput).layout, updatedAt: savedAt }),
    );
  jest.mocked(apiDelete).mockReset();
  jest.mocked(apiDelete).mockResolvedValue(undefined);
  // La grilla mide 1236 px: 12 columnas de 81 px con 24 de separación (paso de 105 px).
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 1236,
    height: 800,
    top: 0,
    left: 0,
    bottom: 800,
    right: 1236,
  } as DOMRect);
});
afterEach(() => {
  jest.restoreAllMocks();
});

async function startEditing() {
  const user = userEvent.setup();
  renderWithQueryClient(<SummaryPage />);
  await user.click(await screen.findByRole('button', { name: 'Editar diseño' }));
  return user;
}
function drag(handle: HTMLElement, dx: number, dy: number) {
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
}
const sentLayout = () => {
  const body = jest.mocked(apiPut).mock.calls[0]?.[1] as ViewPreferenceInput | undefined;
  if (!body) throw new Error('no se guardó');
  return body;
};
const item = (body: ViewPreferenceInput, id: string) =>
  body.layout.items.find((entry) => entry.id === id);

it('entrar y salir sin cambios no guarda nada', async () => {
  const user = await startEditing();
  const toolbar = screen.getByRole('toolbar', { name: 'Edición del diseño' });
  expect(within(toolbar).getByRole('button', { name: 'Guardar diseño' })).toBeDisabled();
  expect(within(toolbar).getByRole('button', { name: 'Deshacer' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Mover Cumplimiento' })).toBeVisible();
  // En edición el contenido de los bloques queda inerte: no se navega adentro.
  expect(
    screen.getByRole('button', { name: 'Mover Cumplimiento' }).parentElement?.firstElementChild,
  ).toHaveAttribute('inert');
  await user.click(within(toolbar).getByRole('button', { name: 'Cancelar' }));
  expect(screen.getByRole('button', { name: 'Editar diseño' })).toBeVisible();
  expect(apiPut).not.toHaveBeenCalled();
});

it('arrastrar el asa cambia el tamaño y solo se guarda al tocar Guardar', async () => {
  const user = await startEditing();
  // 4 columnas a la derecha: de 8 a 12 de ancho.
  drag(screen.getByRole('button', { name: 'Cambiar el tamaño de Cumplimiento' }), 420, 0);
  expect(apiPut).not.toHaveBeenCalled();
  const save = screen.getByRole('button', { name: 'Guardar diseño' });
  expect(save).toBeEnabled();
  await user.click(save);
  await waitFor(() => {
    expect(apiPut).toHaveBeenCalledTimes(1);
  });
  const body = sentLayout();
  expect(body.baseUpdatedAt).toBeNull();
  expect(item(body, 'compliance')).toMatchObject({ x: 0, y: 6, w: 12, h: 8 });
  // Turnos de hoy no entra al lado: baja, sin superponerse.
  expect(item(body, 'shiftsToday')?.y).toBeGreaterThanOrEqual(14);
  expect(await screen.findByRole('button', { name: 'Editar diseño' })).toBeVisible();
});

it('mover un bloque y deshacer vuelve a como estaba', async () => {
  const user = await startEditing();
  // Turnos de hoy a la columna 0, arriba de todo (5 filas hacia arriba).
  drag(screen.getByRole('button', { name: 'Mover Turnos de hoy' }), -840, -360);
  const undo = screen.getByRole('button', { name: 'Deshacer' });
  expect(undo).toBeEnabled();
  await user.click(undo);
  expect(screen.getByRole('button', { name: 'Guardar diseño' })).toBeDisabled();
});

it('guardar el diseño por defecto borra la preferencia', async () => {
  api.state.savedLayout = {
    version: adminSummaryCatalog.version,
    items: adminSummaryCatalog.defaultLayout.items.map((entry) =>
      entry.id === 'account' ? { ...entry, hidden: true } : entry,
    ),
  };
  const user = await startEditing();
  await user.click(screen.getByRole('button', { name: 'Restablecer diseño' }));
  await user.click(screen.getByRole('button', { name: 'Guardar diseño' }));
  await waitFor(() => {
    expect(apiDelete).toHaveBeenCalledWith(
      '/mis-preferencias/vistas/admin-summary',
      expect.anything(),
    );
  });
  expect(apiPut).not.toHaveBeenCalled();
});

it('cancelar con cambios pide confirmación', async () => {
  const user = await startEditing();
  drag(screen.getByRole('button', { name: 'Cambiar el tamaño de Cumplimiento' }), 420, 0);
  await user.click(screen.getByRole('button', { name: 'Cancelar' }));
  const dialog = await screen.findByRole('alertdialog', { name: '¿Descartar los cambios?' });
  await user.click(within(dialog).getByRole('button', { name: 'Seguir editando' }));
  expect(screen.getByRole('button', { name: 'Guardar diseño' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Cancelar' }));
  await user.click(await screen.findByRole('button', { name: 'Descartar cambios' }));
  expect(screen.getByRole('button', { name: 'Editar diseño' })).toBeVisible();
  expect(apiPut).not.toHaveBeenCalled();
});

it('si otro guardó mientras tanto, deja elegir y vuelve a guardar sobre lo nuevo', async () => {
  const user = await startEditing();
  drag(screen.getByRole('button', { name: 'Cambiar el tamaño de Cumplimiento' }), 420, 0);
  jest
    .mocked(apiPut)
    .mockRejectedValueOnce(new ApiError('conflicto', 409, { code: VIEW_PREFERENCE_CONFLICT_CODE }));
  await user.click(screen.getByRole('button', { name: 'Guardar diseño' }));
  const alert = await screen.findByText(/Tu diseño cambió desde otra pestaña/);
  // El otro dispositivo guardó un diseño con la cuenta oculta.
  api.state.savedLayout = {
    version: adminSummaryCatalog.version,
    items: adminSummaryCatalog.defaultLayout.items.map((entry) =>
      entry.id === 'account' ? { ...entry, hidden: true } : entry,
    ),
  };
  api.state.updatedAt = '2026-11-23T11:30:00.000Z';
  await user.click(
    within(alert.parentElement ?? alert).getByRole('button', { name: 'Seguir con mis cambios' }),
  );
  await waitFor(() => {
    expect(screen.queryByText(/Tu diseño cambió desde otra pestaña/)).toBeNull();
  });
  await user.click(screen.getByRole('button', { name: 'Guardar diseño' }));
  await waitFor(() => {
    expect(apiPut).toHaveBeenCalledTimes(2);
  });
  const retry = jest.mocked(apiPut).mock.calls[1]?.[1] as ViewPreferenceInput;
  expect(retry.baseUpdatedAt).toBe('2026-11-23T11:30:00.000Z');
  expect(item(retry, 'compliance')?.w).toBe(12);
});

it('en pantallas angostas no ofrece editar', async () => {
  window.matchMedia = jest.fn().mockReturnValue({
    matches: false,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  });
  renderWithQueryClient(<SummaryPage />);
  expect(await screen.findByRole('region', { name: 'Atención ahora' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Editar diseño' })).toBeNull();
  Reflect.deleteProperty(window, 'matchMedia');
});
