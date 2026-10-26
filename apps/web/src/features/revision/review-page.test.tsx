import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { apiGet, apiPost } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { ReviewDetailPage, ReviewPage } from './review-page';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn(), apiPost: jest.fn() }));
jest.mock('react-router', () => ({
  ...jest.requireActual<Record<string, unknown>>('@/test/react-router'),
  useParams: () => ({ id: 'w1' }),
}));

const detail = {
  id: 'w1',
  shiftId: 's1',
  siteId: 'p1',
  siteName: 'Depósito',
  roundName: 'Perimetral',
  status: 'in_review',
  severityLevel: 'grave',
  startsAt: '2026-01-01T10:00:00Z',
  endsAt: '2026-01-01T11:00:00Z',
  recordedCount: 1,
  expectedCount: 1,
  records: [
    {
      id: 'r1',
      checkpointName: 'Portón',
      occurredAtDevice: '2026-01-01T10:10:00Z',
      invalidated: false,
      flags: [{ type: 'simulated_location', severity: 'grave', reason: 'Ubicación simulada' }],
    },
  ],
  decisions: [
    {
      id: 'd1',
      kind: 'invalidate',
      checkpointRecordId: 'r2',
      comment: 'Registro inválido',
      decidedAt: '2026-01-01T11:00:00Z',
      decidedBy: 'Ana Pérez',
    },
  ],
};

it('muestra la lista, el contador y las ventanas de más de 24 horas', async () => {
  jest.mocked(apiGet).mockResolvedValue({
    count: 1,
    items: [
      {
        id: 'w1',
        status: 'in_review',
        severityLevel: 'grave',
        startsAt: detail.startsAt,
        endsAt: detail.endsAt,
        windowIndex: 0,
        recordedCount: 1,
        expectedCount: 1,
        overdue: true,
        shift: { id: 's1', site: { id: 'p1', name: 'Depósito' } },
        round: { name: 'Perimetral' },
      },
    ],
  });
  renderWithQueryClient(
    <MemoryRouter>
      <ReviewPage />
    </MemoryRouter>,
  );
  expect(await screen.findByText('1 ventana pendiente')).toBeInTheDocument();
  expect(screen.getByText('Más de 24 h pendiente')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Ver detalle' })).toHaveAttribute('href', '/revision/w1');
});

it('valida el comentario del diálogo y muestra el historial', async () => {
  jest.mocked(apiGet).mockResolvedValue(detail);
  jest.mocked(apiPost).mockResolvedValue({ ...detail, status: 'complete' });
  const user = userEvent.setup();
  renderWithQueryClient(
    <MemoryRouter initialEntries={['/revision/w1']}>
      <Routes>
        <Route path="/revision/:id" element={<ReviewDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/Ana Pérez/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Validar ventana' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByLabelText('Comentario o motivo')).toHaveAttribute('minlength', '5');
  await user.type(screen.getByLabelText('Comentario o motivo'), 'Recorrido verificado por cámara');
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Validar ventana' }),
  );
  await waitFor(() => {
    expect(apiPost).toHaveBeenCalledWith(
      '/ventanas-ronda/w1/validar',
      { comment: 'Recorrido verificado por cámara' },
      expect.anything(),
      expect.anything(),
    );
  });
});
