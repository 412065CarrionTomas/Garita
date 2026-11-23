import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FavoritesInput } from '@garita/shared';
import { ApiError, apiGet, apiPut } from '@/lib/api-client';
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
const favoritesPath = '/mis-favoritos/admin-summary/site';

beforeEach(() => {
  api.reset();
  jest.mocked(apiGet).mockReset();
  jest.mocked(apiGet).mockImplementation((path: string) => api.respond(path));
  jest.mocked(apiPut).mockReset();
  jest
    .mocked(apiPut)
    .mockImplementation((_path: string, body: unknown) =>
      Promise.resolve({ ids: (body as FavoritesInput).ids }),
    );
});

async function sitesBlock() {
  const user = userEvent.setup();
  renderWithQueryClient(<SummaryPage />);
  const block = await screen.findByRole('region', { name: /Predios/ });
  await within(block).findByText('Depósito Sur');
  return { user, block };
}
const rowNames = (block: HTMLElement) =>
  within(block)
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelector('td')?.textContent ?? '');
const favoritesSaved = () =>
  jest
    .mocked(apiPut)
    .mock.calls.filter(([path]) => path === favoritesPath)
    .map(([, body]) => (body as FavoritesInput).ids);

it('fija un predio al instante, lo muestra primero y permite deshacer', async () => {
  const { user, block } = await sitesBlock();
  expect(rowNames(block)).toEqual(['Depósito Sur', 'Planta Este', 'Oficinas Centro']);
  await user.click(within(block).getByRole('button', { name: 'Acciones de Oficinas Centro' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Fijar arriba de todo' }));
  expect(rowNames(block)[0]).toBe('Oficinas Centro(fijado)');
  await waitFor(() => {
    expect(favoritesSaved()).toEqual([['p2']]);
  });
  const notice = within(block).getByText('Oficinas Centro quedó fijado arriba de todo.');
  expect(notice).toBeVisible();
  await user.click(within(block).getByRole('button', { name: 'Deshacer' }));
  await waitFor(() => {
    expect(favoritesSaved()).toEqual([['p2'], []]);
  });
  expect(rowNames(block)).toEqual(['Depósito Sur', 'Planta Este', 'Oficinas Centro']);
});

it('reordena los fijados sin perder los que no se ven en el bloque', async () => {
  // "fuera" está fijado pero no tuvo rondas en el período: no aparece, pero no se pierde.
  api.state.favoriteSites = ['p1', 'fuera', 'p3'];
  const { user, block } = await sitesBlock();
  expect(rowNames(block).slice(0, 2)).toEqual(['Depósito Sur(fijado)', 'Planta Este(fijado)']);
  await user.click(within(block).getByRole('button', { name: 'Acciones de Planta Este' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Mover al principio' }));
  await waitFor(() => {
    expect(favoritesSaved()).toEqual([['p3', 'fuera', 'p1']]);
  });
  await user.click(within(block).getByRole('button', { name: 'Acciones de Depósito Sur' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Quitar de fijados' }));
  await waitFor(() => {
    expect(favoritesSaved().at(-1)).toEqual(['p3', 'fuera']);
  });
});

it('mover un predio no fijado es solo de esta visita y no se guarda', async () => {
  const { user, block } = await sitesBlock();
  await user.click(within(block).getByRole('button', { name: 'Acciones de Depósito Sur' }));
  const menu = await screen.findByRole('menu');
  expect(within(menu).queryByRole('menuitem', { name: 'Mover al principio' })).toBeNull();
  await user.click(within(menu).getByRole('menuitem', { name: 'Mover al final' }));
  expect(rowNames(block)).toEqual(['Planta Este', 'Oficinas Centro', 'Depósito Sur']);
  expect(favoritesSaved()).toEqual([]);
  expect(
    await screen.findByText('Depósito Sur pasó al final (solo en esta visita).'),
  ).toBeInTheDocument();
});

it('si no se puede guardar, vuelve atrás y lo avisa', async () => {
  jest.mocked(apiPut).mockRejectedValueOnce(new ApiError('falla', 500));
  const { user, block } = await sitesBlock();
  await user.click(within(block).getByRole('button', { name: 'Acciones de Planta Este' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Fijar arriba de todo' }));
  expect(await within(block).findByText('No pudimos guardar el cambio.')).toBeVisible();
  expect(rowNames(block)).toEqual(['Depósito Sur', 'Planta Este', 'Oficinas Centro']);
  expect(within(block).queryByRole('button', { name: 'Deshacer' })).toBeNull();
});

describe('mantener apretado el ⋮', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      height: 48,
      width: 600,
      top: 0,
      left: 0,
      bottom: 48,
      right: 600,
    } as DOMRect);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('arrastra un fijado a otro lugar y lo guarda; un toque corto abre el menú', async () => {
    api.state.favoriteSites = ['p1', 'p3', 'p2'];
    renderWithQueryClient(<SummaryPage />);
    const block = await screen.findByRole('region', { name: /Predios/ });
    await within(block).findByText('Depósito Sur');
    const handle = within(block).getByRole('button', { name: 'Acciones de Depósito Sur' });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 7, clientX: 10, clientY: 10 });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 10, clientY: 10 + 100 });
    fireEvent.pointerUp(handle, { pointerId: 7 });
    fireEvent.click(handle);
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => {
      expect(favoritesSaved()).toEqual([['p3', 'p2', 'p1']]);
    });
    // Un toque corto (sin esperar) no arrastra: abre el menú.
    fireEvent.pointerDown(handle, { button: 0, pointerId: 8, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(handle, { pointerId: 8 });
    fireEvent.click(handle);
    expect(await screen.findByRole('menu')).toBeVisible();
  });
});
