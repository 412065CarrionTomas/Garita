import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type * as ReactRouter from 'react-router';
import type * as ApiClient from '@/lib/api-client';
import { MemoryRouter } from 'react-router';
import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { IncidentDetailPage, IncidentsPage } from './incidents-page';

jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual<typeof ApiClient>('@/lib/api-client'),
  apiGet: jest.fn(),
  apiPost: jest.fn(),
}));
jest.mock('react-router', () => {
  const actual = jest.requireActual<typeof ReactRouter>('react-router');
  return { ...actual, useParams: () => ({ id: 'incident-1' }) };
});

beforeEach(() => {
  jest.clearAllMocks();
  // La casilla de Radix mide su tamaño; jsdom no trae ResizeObserver.
  globalThis.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));
});

const TZ = 'America/Argentina/Buenos_Aires';
const item = {
  id: 'incident-1',
  type: 'intrusion',
  description: 'Portón forzado en lateral este',
  occurredAt: '2026-10-21T02:00:00.000Z',
  createdAt: '2026-10-21T02:00:00.000Z',
  classificationStatus: 'pending',
  severity: null,
  followUpStatus: 'none',
  photoCount: 1,
  site: { id: 'site-1', name: 'Predio A' },
  guardName: 'Pedro Díaz (desactivado)',
  overdue: true,
  ageMs: 27 * 3_600_000,
};
const second = { ...item, id: 'incident-2', type: 'accident', overdue: false, ageMs: 600_000 };
const detail = {
  id: 'incident-1',
  type: 'intrusion',
  description: 'Portón forzado en lateral este',
  occurredAt: '2026-10-21T02:00:00.000Z',
  receivedAt: '2026-10-21T02:01:00.000Z',
  classificationStatus: 'pending',
  severity: null,
  followUpStatus: 'none',
  timezone: TZ,
  site: { id: 'site-1', name: 'Predio A' },
  guardName: 'Pedro Díaz (desactivado)',
  location: null,
  photos: [{ id: 'p1', thumbnailUrl: 'https://x/t.jpg', fullUrl: 'https://x/f.jpg' }],
  timeline: [],
  shiftContext: {
    shiftId: 'shift-1',
    startsAt: '2026-10-21T00:00:00.000Z',
    endsAt: '2026-10-21T08:00:00.000Z',
    roundName: 'Perímetro',
    lastCheckpoint: { name: 'Portón norte', at: '2026-10-21T01:40:00.000Z' },
  },
  relatedIncidents: [],
};

function mockApi(overrides: Record<string, unknown> = {}) {
  // Como el cliente real, la respuesta pasa por el esquema (fechas incluidas).
  jest.mocked(apiGet).mockImplementation((path, schema) => {
    const respond = (data: unknown) => Promise.resolve(schema.parse(data));
    const key = Object.keys(overrides).find((prefix) => path === prefix);
    if (key) return respond(overrides[key]);
    if (path === '/incidentes/cola/cantidad') return respond({ count: 2 });
    if (path === '/incidentes/cola') return respond({ items: [item, second], timezone: TZ });
    if (path.startsWith('/incidentes/incident-')) return respond(detail);
    if (path === '/predios') return respond([{ id: 'site-1', name: 'Predio A' }]);
    return respond({
      items: [item],
      total: 1,
      page: 1,
      pageSize: 25,
      timezone: TZ,
      counts: { pending: 2, high: 3, followUpOpen: 4 },
    });
  });
}

function renderAt(url: string, ui = <IncidentsPage />) {
  // El router de los tests lee la ruta de window.location.
  window.history.pushState({}, '', url);
  return renderWithQueryClient(<MemoryRouter>{ui}</MemoryRouter>);
}

it('la bandeja abre el más antiguo, muestra su antigüedad y el contexto del turno', async () => {
  mockApi();
  renderAt('/incidentes');
  expect(await screen.findByRole('button', { name: 'Por clasificar (2)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const list = await screen.findByRole('list', { name: 'Incidentes por clasificar' });
  expect(within(list).getByText('hace 27 h')).toBeInTheDocument();
  expect(within(list).getByText('(más de 24 h)', { exact: false })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Intrusión', level: 2 })).toBeInTheDocument();
  expect(screen.getByText('Portón norte', { exact: false })).toBeInTheDocument();
  expect(screen.getByText('Perímetro')).toBeInTheDocument();
});

it('clasifica con gravedad por teclado y pasa al siguiente', async () => {
  mockApi();
  jest
    .mocked(apiPost)
    .mockResolvedValue({ classificationStatus: 'internal', decidedAt: '2026-10-21T03:00:00Z' });
  renderAt('/incidentes?vista=por-clasificar');
  const form = await screen.findByRole('form', { name: 'Clasificar incidente' });
  fireEvent.keyDown(window, { key: '3' });
  fireEvent.change(within(form).getByLabelText('Comentario interno'), {
    target: { value: 'Se revisó el cerco' },
  });
  fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
  await waitFor(() => {
    expect(jest.mocked(apiPost)).toHaveBeenCalledWith(
      '/incidentes/incident-1/clasificar',
      {
        classification: 'internal',
        severity: 'high',
        requiresFollowUp: false,
        internalComment: 'Se revisó el cerco',
      },
      expect.anything(),
      expect.anything(),
    );
  });
  expect(await screen.findByText(/interno, gravedad alta/)).toBeInTheDocument();
});

it('si otro ya lo clasificó (409) avisa en vez de mostrar un error', async () => {
  mockApi();
  jest.mocked(apiPost).mockRejectedValue(new ApiError('Conflicto', 409));
  renderAt('/incidentes?vista=por-clasificar');
  const form = await screen.findByRole('form', { name: 'Clasificar incidente' });
  fireEvent.change(within(form).getByLabelText('Comentario interno'), {
    target: { value: 'Comentario válido' },
  });
  fireEvent.submit(form);
  expect(await screen.findByText(/otra persona ya lo había clasificado/)).toBeInTheDocument();
  expect(screen.queryByText(/No se pudo guardar/)).not.toBeInTheDocument();
});

it('con fechas invertidas avisa y no consulta', async () => {
  mockApi();
  renderAt('/incidentes?vista=todos&desde=2026-11-10&hasta=2026-11-01');
  expect(await screen.findByRole('alert')).toHaveTextContent('anterior o igual');
  expect(jest.mocked(apiGet)).not.toHaveBeenCalledWith(
    expect.stringMatching(/^\/incidentes\?/),
    expect.anything(),
  );
});

it('sin vista en la URL elige una sola vez según haya pendientes', async () => {
  mockApi({ '/incidentes/cola/cantidad': { count: 0 } });
  renderAt('/incidentes');
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true');
  });
  expect(jest.mocked(apiGet)).not.toHaveBeenCalledWith('/incidentes/cola', expect.anything());
});

it('el archivo manda los filtros de la URL a la consulta y los chips filtran', async () => {
  mockApi();
  renderAt('/incidentes?vista=todos&tipo=intrusion');
  expect(await screen.findByRole('table', { name: 'Incidentes' })).toBeInTheDocument();
  expect(jest.mocked(apiGet)).toHaveBeenCalledWith(
    expect.stringMatching(/^\/incidentes\?.*tipo=intrusion/),
    expect.anything(),
  );
  fireEvent.click(screen.getByRole('button', { name: '3 gravedad alta' }));
  await waitFor(() => {
    expect(jest.mocked(apiGet)).toHaveBeenCalledWith(
      expect.stringMatching(/gravedad=high/),
      expect.anything(),
    );
  });
  expect(screen.getByRole('link', { name: 'Intrusión' })).toHaveAttribute(
    'href',
    '/incidentes/incident-1',
  );
});

it('si falla el conteo inicial abre la bandeja en vez de quedar cargando', async () => {
  mockApi();
  const base = jest.mocked(apiGet).getMockImplementation();
  jest
    .mocked(apiGet)
    .mockImplementation((path, schema) =>
      path === '/incidentes/cola/cantidad'
        ? Promise.reject(new Error('Sin red'))
        : (base?.(path, schema) ?? Promise.reject(new Error('sin mock'))),
    );
  renderAt('/incidentes');
  expect(
    await screen.findByRole('list', { name: 'Incidentes por clasificar' }),
  ).toBeInTheDocument();
});

it('reclasificar parte de la visibilidad, la gravedad y la nota al cliente vigentes', async () => {
  mockApi({
    '/incidentes/incident-1': {
      ...detail,
      classificationStatus: 'client_visible',
      severity: 'high',
      timeline: [
        {
          kind: 'classification',
          id: 'c1',
          at: '2026-10-21T03:00:00.000Z',
          author: 'Ana Gómez',
          classification: 'client_visible',
          severity: 'high',
          requiresFollowUp: false,
          internalComment: 'Se avisó al cliente',
          clientNote: 'Reforzamos la ronda nocturna',
          reason: null,
        },
      ],
    },
  });
  renderAt('/incidentes/incident-1', <IncidentDetailPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reclasificar' }));
  const form = await screen.findByRole('form', { name: 'Reclasificar incidente' });
  expect(within(form).getByRole('radio', { name: /Visible al cliente/ })).toBeChecked();
  expect(within(form).getByRole('radio', { name: /Alta/ })).toBeChecked();
  expect(within(form).getByLabelText('Nota para el cliente (opcional)')).toHaveValue(
    'Reforzamos la ronda nocturna',
  );
});

it('el detalle muestra la bitácora y permite cerrar el seguimiento', async () => {
  mockApi({
    '/incidentes/incident-1': {
      ...detail,
      classificationStatus: 'internal',
      severity: 'high',
      followUpStatus: 'open',
      timeline: [
        {
          kind: 'classification',
          id: 'c1',
          at: '2026-10-21T03:00:00.000Z',
          author: 'Ana Gómez',
          classification: 'internal',
          severity: 'high',
          requiresFollowUp: true,
          internalComment: 'Reparar el cerco',
          clientNote: null,
          reason: null,
        },
      ],
    },
  });
  jest.mocked(apiPost).mockResolvedValue({ followUpStatus: 'closed' });
  renderAt('/incidentes/incident-1', <IncidentDetailPage />);
  expect(await screen.findByRole('heading', { name: 'Intrusión', level: 1 })).toBeInTheDocument();
  expect(screen.getByText('Reparar el cerco')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reclasificar' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Registrar acción o cierre'), {
    target: { value: 'Cerco reparado' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar seguimiento' }));
  await waitFor(() => {
    expect(jest.mocked(apiPost)).toHaveBeenCalledWith(
      '/incidentes/incident-1/seguimiento/cerrar',
      { text: 'Cerco reparado' },
      expect.anything(),
      expect.anything(),
    );
  });
});
