import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiGet, apiPost } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { ReviewPage } from './review-page';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn(), apiPost: jest.fn() }));
let routeId: string | undefined;
jest.mock('react-router', () => ({
  ...jest.requireActual<Record<string, unknown>>('@/test/react-router'),
  useParams: () => ({ id: routeId }),
}));

beforeEach(() => {
  routeId = undefined;
  window.history.replaceState({}, '', '/revision');
});

const record = {
  id: 'r1',
  checkpointName: 'Portón',
  occurredAtDevice: '2026-01-01T10:10:00Z',
  invalidated: false,
  method: 'qr',
  radiusMeters: 30,
  isIndoor: false,
  accuracyMeters: 10,
  distanceMeters: 445,
  secondsFromPrevious: null,
  flags: [{ type: 'simulated_location', severity: 'grave', reason: null }],
};
const detail = {
  id: 'w1',
  shiftId: 's1',
  siteName: 'Depósito',
  roundName: 'Perimetral',
  timezone: 'UTC',
  status: 'in_review',
  severityLevel: 'grave',
  startsAt: '2026-01-01T10:00:00Z',
  endsAt: '2026-01-01T11:00:00Z',
  inReviewSince: '2026-01-01T11:15:00Z',
  windowIndex: 0,
  recordedCount: 2,
  expectedCount: 2,
  guardName: 'Juan Gómez',
  guardHistory: { days: 30, records: 120, graveFlags: 4, invalidatedRecords: 1 },
  records: [
    record,
    { ...record, id: 'r2', checkpointName: 'Galpón', distanceMeters: 5, flags: [] },
  ],
  decisions: [],
};
const item = (id: string, round: string) => ({
  id,
  status: 'in_review',
  severityLevel: 'grave',
  startsAt: detail.startsAt,
  endsAt: detail.endsAt,
  inReviewSince: detail.inReviewSince,
  windowIndex: 0,
  recordedCount: 2,
  expectedCount: 2,
  overdue: true,
  shift: { id: 's1', site: { id: 'p1', name: 'Depósito' } },
  round: { name: round },
  guardName: 'Juan Gómez',
  flags: { grave: 1, media: 0, leve: 0, types: ['simulated_location'] },
  resolution: null,
});
const queue = {
  timezone: 'UTC',
  count: 2,
  overdue: 2,
  resolvedLastDay: 0,
  items: [item('w1', 'Perimetral'), item('w2', 'Interna')],
};

function renderPage(id?: string) {
  routeId = id;
  // Pasa por el esquema real, como apiGet: valida los datos de prueba y convierte las fechas.
  jest
    .mocked(apiGet)
    .mockImplementation((url, schema) =>
      Promise.resolve(
        schema.parse(url.startsWith('/ventanas-ronda/en-revision') ? queue : detail) as never,
      ),
    );
  return renderWithQueryClient(<ReviewPage />);
}

it('abre la primera ventana con el vigilador, la evidencia y los antecedentes', async () => {
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Perimetral · ventana 1' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Pendientes (2)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // La lectura marcada trae su evidencia; la limpia va resumida aparte.
  const flagged = screen.getByRole('region', { name: 'Lecturas a decidir (1)' });
  expect(within(flagged).getByText('Ubicación simulada')).toBeVisible();
  expect(within(flagged).getByText('445 m del punto')).toBeVisible();
  expect(within(flagged).getByText('radio 30 m')).toBeVisible();
  expect(screen.getByRole('region', { name: 'Sin marcas (1)' })).toHaveTextContent('Galpón');
  expect(screen.getByText(/en 120 lecturas/)).toBeVisible();
  expect(screen.getAllByText('Juan Gómez').length).toBeGreaterThan(0);
});

it('filtra la bandeja con la búsqueda', async () => {
  const user = userEvent.setup();
  renderPage();
  const list = await screen.findByRole('list', { name: 'Ventanas en revisión' });
  await user.type(screen.getByRole('searchbox', { name: 'Buscar ventanas' }), 'interna');
  await waitFor(() => {
    expect(within(list).queryByText(/Perimetral/)).not.toBeInTheDocument();
  });
  expect(within(list).getByText(/Interna/)).toBeVisible();
});

it('invalida una lectura marcada con su motivo', async () => {
  jest.mocked(apiPost).mockResolvedValue(detail);
  const user = userEvent.setup();
  renderPage('w1');
  const flagged = await screen.findByRole('region', { name: 'Lecturas a decidir (1)' });
  await user.click(within(flagged).getByRole('button', { name: 'Invalidar' }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Invalidar registro' }));
  expect(within(dialog).getByRole('alert')).toHaveTextContent('entre 5 y 500');
  await user.type(within(dialog).getByLabelText(/Motivo/), 'GPS simulado confirmado');
  await user.click(within(dialog).getByRole('button', { name: 'Invalidar registro' }));
  await waitFor(() => {
    expect(apiPost).toHaveBeenCalledWith(
      '/registros-puntos/r1/invalidar',
      { comment: 'GPS simulado confirmado' },
      expect.anything(),
      expect.anything(),
    );
  });
  expect(apiPost).toHaveBeenCalledTimes(1);
});

it('pide a la API las rondas del rango de fechas elegido', async () => {
  window.history.replaceState(
    {},
    '',
    '/revision?estado=resueltas&desde=2026-11-20&hasta=2026-11-22',
  );
  renderPage();
  await screen.findByRole('list', { name: 'Ventanas resueltas' });
  expect(apiGet).toHaveBeenCalledWith(
    '/ventanas-ronda/en-revision?estado=resueltas&desde=2026-11-20&hasta=2026-11-22',
    expect.anything(),
  );
  expect(screen.getByLabelText('Rondas desde')).toHaveValue('2026-11-20');
  expect(screen.getByRole('button', { name: 'Quitar fechas' })).toBeVisible();
});
