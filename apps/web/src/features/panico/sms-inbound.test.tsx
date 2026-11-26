import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { apiGet } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { SmsInboundPage } from './sms-inbound-page';
import { SmsBadges } from './sms-badges';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn() }));
beforeEach(() => jest.clearAllMocks());
it('expone las tres indicaciones por texto', () => {
  renderWithQueryClient(<SmsBadges channel="sms" authenticated={false} phoneMismatch />);
  for (const label of ['Por SMS', 'No verificada', 'El número no coincide'])
    expect(screen.getByText(label)).toBeVisible();
});
const resumen = { valid: 3, unverified: 1, unknown: 2 };
it('filtra por estado, contadores y búsqueda, y salta de página por número', async () => {
  jest.mocked(apiGet).mockResolvedValue({ items: [], total: 30, page: 1, pageSize: 20, resumen });
  renderWithQueryClient(
    <MemoryRouter>
      <SmsInboundPage />
    </MemoryRouter>,
  );
  await screen.findByText('No hay SMS para estos filtros');
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Estado' }), 'unknown');
  await waitFor(() => {
    expect(apiGet).toHaveBeenLastCalledWith(
      '/sms-recibidos?pagina=1&porPagina=20&estado=unknown',
      expect.anything(),
    );
  });
  await user.click(screen.getByRole('button', { name: 'Página 2' }));
  await waitFor(() => {
    expect(apiGet).toHaveBeenLastCalledWith(
      '/sms-recibidos?pagina=2&porPagina=20&estado=unknown',
      expect.anything(),
    );
  });
  const summary = screen.getByRole('group', { name: 'Resumen de SMS' });
  const unknown = within(summary).getByRole('button', { name: /Desconocidos/ });
  expect(unknown).toHaveAttribute('aria-pressed', 'true');
  await user.click(unknown);
  await user.type(screen.getByRole('searchbox', { name: 'Buscar SMS' }), 'ayuda');
  await waitFor(() => {
    expect(apiGet).toHaveBeenLastCalledWith(
      '/sms-recibidos?pagina=1&porPagina=20&buscar=ayuda',
      expect.anything(),
    );
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Estado' }), { target: { value: '' } });
});
it('muestra remitente, horas y enlace de la alerta asociada', async () => {
  jest.mocked(apiGet).mockResolvedValue({
    items: [
      {
        id: 'sms',
        result: 'unverified',
        fromOriginal: '+5493511234567',
        text: 'Ayuda portón',
        gatewayReceivedAt: '2035-01-01T12:00:00Z',
        receivedAt: '2035-01-01T12:00:01Z',
        alertId: 'alert',
        sender: { guardName: 'Bruno Paz', siteName: 'Predio Norte' },
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    resumen,
  });
  renderWithQueryClient(
    <MemoryRouter>
      <SmsInboundPage />
    </MemoryRouter>,
  );
  expect(await screen.findByText('Ayuda portón')).toBeVisible();
  expect(screen.getByText('Bruno Paz · Predio Norte')).toBeVisible();
  // Llegó 1 segundo después: la hora de la pasarela no suma nada.
  expect(screen.queryByText(/Pasarela:/)).not.toBeInTheDocument();
  expect(screen.getByText('No verificado', { selector: '[data-slot="badge"]' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Ver alerta' })).toHaveAttribute(
    'href',
    '/alertas-panico/alert',
  );
});
