import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { adminSummaryCatalog, type ViewPreferenceInput } from '@garita/shared';
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

async function openPanel() {
  const user = userEvent.setup();
  renderWithQueryClient(<SummaryPage />);
  await user.click(await screen.findByRole('button', { name: 'Editar diseño' }));
  await user.click(screen.getByRole('button', { name: 'Bloques' }));
  return { user, panel: await screen.findByRole('dialog', { name: 'Bloques del diseño' }) };
}

it('oculta, cambia la presentación y los ajustes, y lo guarda todo junto', async () => {
  const { user, panel } = await openPanel();
  await user.click(within(panel).getByRole('switch', { name: 'Cuenta' }));
  await user.click(within(panel).getByRole('button', { name: 'Columna' }));
  const compliancePeriod = within(panel).getByRole('group', { name: 'Período de Cumplimiento' });
  await user.click(within(compliancePeriod).getByRole('button', { name: '7 días' }));
  const sitesOrder = within(panel).getByRole('group', { name: 'Orden de Predios' });
  await user.click(within(sitesOrder).getByRole('button', { name: 'Por nombre' }));
  expect(within(panel).getByRole('switch', { name: 'Cuenta' })).not.toBeChecked();
  await user.keyboard('{Escape}');

  // Los cambios se ven al instante, todavía sin guardar.
  expect(screen.queryByRole('region', { name: 'Cuenta' })).toBeNull();
  expect(await screen.findByRole('region', { name: /Cumplimiento · 7 días/ })).toBeVisible();
  expect(screen.getByRole('button', { name: /Bloques\s*1 ocultos/ })).toBeVisible();
  expect(apiPut).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Guardar diseño' }));
  await waitFor(() => {
    expect(apiPut).toHaveBeenCalledTimes(1);
  });
  const { layout } = jest.mocked(apiPut).mock.calls[0]?.[1] as ViewPreferenceInput;
  const byId = (id: string) => layout.items.find((item) => item.id === id);
  expect(byId('account')?.hidden).toBe(true);
  expect(byId('attention')?.presentation).toBe('column');
  expect(byId('compliance')?.settings).toEqual({ period: '7d' });
  expect(byId('sites')?.settings).toEqual({ sort: 'name', limit: '5' });
});

it('los cambios del panel se deshacen de a uno', async () => {
  const { user, panel } = await openPanel();
  await user.click(within(panel).getByRole('switch', { name: 'Incidentes' }));
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('region', { name: /Incidentes/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Deshacer' }));
  expect(await screen.findByRole('region', { name: /Incidentes · 30 días/ })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Guardar diseño' })).toBeDisabled();
});

it('con todos los bloques ocultos avisa cómo recuperarlos', async () => {
  const { user, panel } = await openPanel();
  for (const id of Object.keys(adminSummaryCatalog.widgets)) {
    const title = adminSummaryCatalog.widgets[id as keyof typeof adminSummaryCatalog.widgets].title;
    await user.click(within(panel).getByRole('switch', { name: title }));
  }
  await user.keyboard('{Escape}');
  expect(screen.getByText('Todos los bloques están ocultos')).toBeVisible();
  expect(screen.getByText('Mostralos desde Bloques, o restablecé el diseño.')).toBeVisible();
});
