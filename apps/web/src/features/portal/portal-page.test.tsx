import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type PortalRounds, PORTAL_VERIFICATION_MESSAGE } from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { PortalPage } from './portal-page';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn() }));
jest.mock('recharts', () => ({
  ResponsiveContainer: () => null,
  Bar: () => null,
  Rectangle: () => null,
  BarChart: () => null,
  Line: () => null,
  LineChart: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));
const totals = {
  completa: 18,
  incompleta: 1,
  no_realizada: 1,
  en_verificacion: 2,
  evaluated: 20,
  percentage: 90,
};
const report: PortalRounds = {
  desde: '2026-10-01',
  hasta: '2026-11-01',
  timezone: 'UTC',
  totals,
  daily: [{ date: '2026-10-01', totals }],
  verificationMessage: PORTAL_VERIFICATION_MESSAGE,
};
beforeEach(() => {
  jest.mocked(apiGet).mockReset();
  jest.mocked(apiGet).mockImplementation((path) => {
    if (path === '/portal/predios') return Promise.resolve([{ id: 'p1', name: 'Depósito Ruta 9' }]);
    if (path.includes('/fotos'))
      return Promise.resolve([
        { thumbnailUrl: 'https://photos.invalid/thumb', fullUrl: 'https://photos.invalid/full' },
      ]);
    if (path.includes('/rondas/dia'))
      return Promise.resolve({
        total: 1,
        page: 1,
        pageSize: 25,
        items: [
          {
            site: { id: 'p1', name: 'Depósito Ruta 9' },
            startsAt: '2026-10-01T10:00:00Z',
            endsAt: '2026-10-01T11:00:00Z',
            status: 'completa',
          },
        ],
      });
    if (path.includes('/incidentes'))
      return Promise.resolve({
        total: 1,
        page: 1,
        pageSize: 25,
        items: [
          {
            id: 'i1',
            type: 'intrusion',
            site: { id: 'p1', name: 'Depósito Ruta 9' },
            occurredAt: '2026-10-01T10:00:00Z',
            clientNote: 'Portón reparado',
            photoCount: 1,
          },
        ],
      });
    if (path.includes('/emergencias'))
      return Promise.resolve({
        total: 1,
        page: 1,
        pageSize: 25,
        items: [
          {
            site: { id: 'p1', name: 'Depósito Ruta 9' },
            triggeredAt: '2026-10-01T10:00:00Z',
            responseTimeMs: 45000,
          },
        ],
      });
    return Promise.resolve(report);
  });
});
it('muestra porcentaje, verificación, tablas equivalentes, listas y fotos solo al abrir', async () => {
  const user = userEvent.setup();
  renderWithQueryClient(<PortalPage />);
  expect(await screen.findByRole('heading', { name: 'Cumplimiento: 90 %' })).toBeInTheDocument();
  expect(
    screen.getByText(`2 rondas en verificación. ${PORTAL_VERIFICATION_MESSAGE}.`),
  ).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Rondas por estado' })).toBeInTheDocument();
  expect(
    screen.getByRole('table', { name: 'Evolución diaria del cumplimiento' }),
  ).toBeInTheDocument();
  expect(await screen.findByText('Portón reparado')).toBeInTheDocument();
  expect(
    await screen.findByText('Tiempo de respuesta de la empresa: 45 segundos'),
  ).toBeInTheDocument();
  expect(jest.mocked(apiGet).mock.calls.some(([path]) => path.includes('/fotos'))).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Ver fotos (1)' }));
  await user.click(await screen.findByRole('button', { name: 'Ampliar foto 1' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ampliar foto 1' })).toHaveFocus();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
it('permite seleccionar predio y fechas y abrir un día por teclado; completa no muestra demora', async () => {
  const user = userEvent.setup();
  renderWithQueryClient(<PortalPage />);
  await screen.findByRole('option', { name: 'Depósito Ruta 9' });
  await user.tab();
  expect(screen.getByLabelText('Predio')).toHaveFocus();
  await user.selectOptions(screen.getByLabelText('Predio'), 'p1');
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('Hasta (sin incluir)'), {
    target: { value: '2026-11-01' },
  });
  await user.click(screen.getByRole('button', { name: 'Consultar' }));
  await waitFor(() => {
    expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('predio=p1'), expect.anything());
  });
  const day = screen.getByRole('button', { name: 'Ver ventanas: 2026-10-01' });
  day.focus();
  await user.keyboard('{Enter}');
  const region = await screen.findByRole('region', { name: 'Rondas del 2026-10-01' });
  expect(await within(region).findByText('● Completa')).toBeInTheDocument();
  expect(region).not.toHaveTextContent(/demora|grave|vigilador/i);
});
it('muestra vacíos y valida el período antes de consultar', async () => {
  jest.mocked(apiGet).mockImplementation((path) => {
    if (path.includes('/predios')) return Promise.resolve([]);
    if (path.includes('/incidentes') || path.includes('/emergencias'))
      return Promise.resolve({ total: 0, page: 1, pageSize: 25, items: [] });
    return Promise.resolve({
      ...report,
      totals: { ...totals, evaluated: 0, completa: 0, percentage: null },
    });
  });
  const user = userEvent.setup();
  renderWithQueryClient(<PortalPage />);
  expect(await screen.findByText('Sin rondas evaluadas')).toBeInTheDocument();
  expect(await screen.findByText('Sin incidentes compartidos')).toBeInTheDocument();
  expect(await screen.findByText('Sin emergencias')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2025-10-01' } });
  await user.click(screen.getByRole('button', { name: 'Consultar' }));
  expect(screen.getByRole('alert')).toHaveTextContent('hasta 12 meses');
});
it('informa fallas de consulta y permite reintentar', async () => {
  jest.mocked(apiGet).mockRejectedValue(new Error('offline'));
  renderWithQueryClient(<PortalPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo consultar el portal');
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
});
