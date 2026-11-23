import { screen, waitFor, within } from '@testing-library/react';
import { adminSummaryCatalog } from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { createSummaryApi } from '@/test/summary-api';
import { renderWithQueryClient } from '@/test/render';
import { SummaryPage } from './summary-page';

jest.mock('@/lib/api-client', () => {
  const actual: Record<string, unknown> = jest.requireActual('@/lib/api-client');
  return { ApiError: actual.ApiError, apiGet: jest.fn() };
});
// La geometría SVG depende del navegador: se prueban textos, tablas y estados.
jest.mock('recharts', () => {
  const Empty = () => null;
  return new Proxy({}, { get: () => Empty });
});

const api = createSummaryApi();

beforeEach(() => {
  api.reset();
  jest.mocked(apiGet).mockClear();
  jest.mocked(apiGet).mockImplementation((path: string) => api.respond(path));
});

const section = (name: RegExp) => screen.getByRole('region', { name });

it('sin diseño guardado muestra el diseño A con datos reales de cada bloque', async () => {
  renderWithQueryClient(<SummaryPage />);
  expect(screen.getByRole('heading', { level: 1, name: 'Resumen de la empresa' })).toBeVisible();
  const attention = await screen.findByRole('region', { name: 'Atención ahora' });
  expect(await within(attention).findByText(/Depósito Sur · desde/)).toBeVisible();
  expect(within(attention).getByText('Rondas en revisión')).toBeVisible();
  expect(
    within(attention).getByRole('link', { name: /Atender: Alertas de pánico/ }),
  ).toHaveAttribute('href', '/alertas-panico');
  expect(
    await within(section(/Cumplimiento · 30 días/)).findByText('94,2 %', { selector: 'p > span' }),
  ).toBeVisible();
  expect(within(section(/Cumplimiento · 30 días/)).getByText('1 día bajo 90 %')).toBeVisible();
  const sites = section(/Predios · peor cumplimiento primero/);
  const rows = await within(sites).findAllByRole('row');
  const worst = rows[1];
  if (!worst) throw new Error('falta la fila del peor predio');
  expect(worst).toHaveTextContent('Depósito Sur');
  expect(within(worst).getByText('Revisar')).toBeVisible();
  expect(await within(section(/Turnos de hoy/)).findByText('2 en total')).toBeVisible();
  expect(
    await within(section(/Incidentes · 30 días/)).findByText('2 sin clasificar'),
  ).toBeVisible();
  expect(within(section(/Incidentes · 30 días/)).queryByText('Accidente')).toBeNull();
  expect(await within(section(/Cuenta/)).findByText('18 / 20')).toBeVisible();
});

it('respeta el diseño guardado: bloques ocultos, presentación y ajustes', async () => {
  api.state.savedLayout = {
    version: adminSummaryCatalog.version,
    items: adminSummaryCatalog.defaultLayout.items.map((item) => {
      if (item.id === 'account') return { ...item, hidden: true };
      if (item.id === 'attention') return { ...item, presentation: 'column' };
      if (item.id === 'compliance')
        return { ...item, presentation: 'table', settings: { period: '7d' } };
      return item;
    }),
  };
  renderWithQueryClient(<SummaryPage />);
  const compliance = await screen.findByRole('region', { name: /Cumplimiento · 7 días/ });
  expect(await within(compliance).findByRole('table')).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Cuenta' })).toBeNull();
  const attention = screen.getByRole('region', { name: 'Atención ahora' });
  expect(
    await within(attention).findByRole('link', { name: /Alertas de pánico: 1/ }),
  ).toBeVisible();
  await waitFor(() => {
    expect(jest.mocked(apiGet).mock.calls.some(([path]) => path.includes('/cuenta/estado'))).toBe(
      false,
    );
  });
});

it('si no puede leer el diseño, avisa y usa el de defecto', async () => {
  api.state.failing.add('/mis-preferencias');
  renderWithQueryClient(<SummaryPage />);
  expect(await screen.findByText(/No pudimos cargar tu diseño guardado/)).toBeVisible();
  expect(await screen.findByRole('region', { name: 'Atención ahora' })).toBeVisible();
});

it('un bloque que falla no afecta a los demás y permite reintentar', async () => {
  api.state.failing.add('/reportes/incidentes');
  renderWithQueryClient(<SummaryPage />);
  const incidents = await screen.findByRole('region', { name: /Incidentes · 30 días/ });
  expect(await within(incidents).findByRole('button', { name: 'Reintentar' })).toBeVisible();
  expect(
    await within(section(/Cumplimiento · 30 días/)).findByText('94,2 %', { selector: 'p > span' }),
  ).toBeVisible();
});
