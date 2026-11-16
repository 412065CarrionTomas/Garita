import { fireEvent, screen, waitFor } from '@testing-library/react';
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
it('filtra por estado y permite navegar el filtro y la paginación con teclado', async () => {
  jest.mocked(apiGet).mockResolvedValue({ items: [], total: 30, page: 1, pageSize: 25 });
  renderWithQueryClient(
    <MemoryRouter>
      <SmsInboundPage />
    </MemoryRouter>,
  );
  await screen.findByText('No hay SMS para estos filtros');
  const user = userEvent.setup();
  await user.tab();
  expect(screen.getByRole('combobox', { name: 'Estado' })).toHaveFocus();
  await user.selectOptions(screen.getByRole('combobox'), 'unknown');
  await waitFor(() => {
    expect(apiGet).toHaveBeenLastCalledWith(
      '/sms-recibidos?pagina=1&estado=unknown',
      expect.anything(),
    );
  });
  await user.tab();
  expect(screen.getByRole('button', { name: 'Siguiente' })).toHaveFocus();
  await user.keyboard('{Enter}');
  await waitFor(() => {
    expect(apiGet).toHaveBeenLastCalledWith(
      '/sms-recibidos?pagina=2&estado=unknown',
      expect.anything(),
    );
  });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
  await waitFor(() => {
    expect(apiGet).toHaveBeenLastCalledWith('/sms-recibidos?pagina=1', expect.anything());
  });
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
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
  });
  renderWithQueryClient(
    <MemoryRouter>
      <SmsInboundPage />
    </MemoryRouter>,
  );
  expect(await screen.findByText('Ayuda portón')).toBeVisible();
  expect(screen.getByText('No verificado', { selector: '[data-slot="badge"]' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Ver alerta' })).toHaveAttribute(
    'href',
    '/alertas-panico/alert',
  );
});
