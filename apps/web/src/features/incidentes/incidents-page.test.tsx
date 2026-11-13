import { fireEvent, screen, waitFor } from '@testing-library/react';
import type * as ReactRouter from 'react-router';
import { MemoryRouter } from 'react-router';
import { apiGet, apiPost } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { IncidentDetailPage, IncidentsListPage, IncidentsQueuePage } from './incidents-page';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn(), apiPost: jest.fn() }));
jest.mock('react-router', () => {
  const actual = jest.requireActual<typeof ReactRouter>('react-router');
  return {
    ...actual,
    useParams: () => ({ id: 'incident-1' }),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
});

const incident = {
  id: 'incident-1',
  type: 'intrusion',
  description: null,
  createdAt: '2026-10-20T00:00:00.000Z',
  occurredAtDevice: '2026-10-20T02:00:00.000Z',
  trustedAt: '2026-10-21T02:00:00.000Z',
  timezone: 'America/Argentina/Buenos_Aires',
  site: { id: 'site-1', name: 'Predio A' },
  guard: { firstName: 'Pedro', lastName: 'Díaz', status: 'deactivated' },
  classificationStatus: 'pending',
  overdue: true,
};

const detailIncident = {
  id: 'incident-1',
  type: 'intrusion',
  description: 'Portón forzado en lateral este',
  createdAt: '2026-10-20T00:00:00.000Z',
  occurredAtDevice: '2026-10-20T00:00:00.000Z',
  trustedAt: '2026-10-21T02:00:00.000Z',
  timezone: 'America/Argentina/Buenos_Aires',
  site: { id: 'site-1', name: 'Predio A' },
  guard: { name: 'Pedro Díaz (desactivado)' },
  classificationStatus: 'pending',
  latitude: -34.6037,
  longitude: -58.3816,
  photos: [
    {
      id: 'photo-1',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      fullUrl: 'https://example.com/full.jpg',
    },
  ],
  classifications: [],
};

it('muestra la cola antigua con estado textual y acceso por teclado', async () => {
  jest.mocked(apiGet).mockResolvedValueOnce([incident]);
  renderWithQueryClient(
    <MemoryRouter>
      <IncidentsQueuePage />
    </MemoryRouter>,
  );
  expect(await screen.findByText('Más de 24 h pendiente')).toBeInTheDocument();
  expect(screen.getByText('Sin clasificar')).toBeInTheDocument();
  expect(screen.getByText(/Pedro Díaz \(desactivado\)/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Ver detalle' })).toHaveAttribute(
    'href',
    '/incidentes/incident-1',
  );
});

it.each([incident.trustedAt, null])(
  'shows the same occurrence date in list and detail using company timezone (trustedAt=%s)',
  async (trustedAt) => {
    jest
      .mocked(apiGet)
      .mockImplementation((path) =>
        Promise.resolve(
          path === '/predios'
            ? []
            : path === '/incidentes/incident-1'
              ? { ...detailIncident, occurredAtDevice: incident.occurredAtDevice, trustedAt }
              : { items: [{ ...incident, trustedAt }], total: 1, page: 1, pageSize: 25 },
        ),
      );
    const list = renderWithQueryClient(
      <MemoryRouter>
        <IncidentsListPage />
      </MemoryRouter>,
    );
    const when = new Date(trustedAt ?? incident.occurredAtDevice).toLocaleString('es-AR', {
      timeZone: incident.timezone,
    });
    expect(
      await screen.findByText(
        (_text, node) => node?.tagName === 'SPAN' && node.textContent.endsWith(when),
      ),
    ).toBeInTheDocument();
    list.unmount();
    renderWithQueryClient(
      <MemoryRouter>
        <IncidentDetailPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(`Predio A · ${when}`)).toBeInTheDocument();
  },
);

it('envía los filtros del listado a la consulta y conserva etiquetas accesibles', async () => {
  jest
    .mocked(apiGet)
    .mockImplementation((path) =>
      Promise.resolve(
        path === '/predios'
          ? [{ id: 'site-1', name: 'Predio A' }]
          : { items: [incident], total: 1, page: 1, pageSize: 25 },
      ),
    );
  renderWithQueryClient(
    <MemoryRouter>
      <IncidentsListPage />
    </MemoryRouter>,
  );
  await screen.findByText('Intrusión · Predio A');
  fireEvent.change(screen.getByLabelText('Predio'), { target: { value: 'site-1' } });
  fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'intrusion' } });
  fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'pending' } });
  expect(
    jest
      .mocked(apiGet)
      .mock.calls.some(
        ([path]) =>
          typeof path === 'string' &&
          path.includes('predio=site-1') &&
          path.includes('tipo=intrusion') &&
          path.includes('clasificacion=pending'),
      ),
  ).toBe(true);
});

it('muestra el detalle del incidente y valida el diálogo de clasificación', async () => {
  jest.mocked(apiGet).mockImplementation((path: string) => {
    if (path === '/incidentes/incident-1') return Promise.resolve(detailIncident);
    return Promise.resolve([]);
  });
  jest.mocked(apiPost).mockResolvedValue({
    classificationStatus: 'client_visible',
    decidedAt: '2026-10-20T01:00:00.000Z',
  });

  renderWithQueryClient(
    <MemoryRouter>
      <IncidentDetailPage />
    </MemoryRouter>,
  );

  expect(await screen.findByText('Intrusión')).toBeInTheDocument();
  expect(screen.getByText('Portón forzado en lateral este')).toBeInTheDocument();
  expect(screen.getByText(/Pedro Díaz \(desactivado\)/)).toBeInTheDocument();
  expect(screen.getByText('Coordenadas: -34.6037, -58.3816')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Ampliar foto de Intrusión/ })).toBeInTheDocument();

  // Abrir diálogo de clasificación
  fireEvent.click(screen.getByRole('button', { name: 'Clasificar' }));
  expect(screen.getByRole('heading', { name: 'Clasificar incidente' })).toBeInTheDocument();
  const classifyForm = screen.getByRole('form', { name: 'Clasificar incidente' });

  // Enviar vacío produce error de validación
  fireEvent.submit(classifyForm);
  expect(await screen.findByText(/>=5 characters/)).toBeInTheDocument();

  // Completar comentario y nota
  fireEvent.change(screen.getByLabelText('Comentario interno'), {
    target: { value: 'Candado cortado, se procedió a asegurar el portón.' },
  });
  fireEvent.change(screen.getByLabelText('Nota para el cliente (opcional)'), {
    target: { value: 'Portón asegurado por el equipo de seguridad.' },
  });

  fireEvent.submit(classifyForm);
  await waitFor(() => {
    expect(jest.mocked(apiPost)).toHaveBeenCalledWith(
      '/incidentes/incident-1/clasificar',
      {
        classification: 'client_visible',
        internalComment: 'Candado cortado, se procedió a asegurar el portón.',
        clientNote: 'Portón asegurado por el equipo de seguridad.',
      },
      expect.anything(),
      expect.anything(),
    );
  });
});

it('permite reclasificar un incidente indicando motivo obligatorio', async () => {
  const classifiedIncident = {
    ...detailIncident,
    classificationStatus: 'internal',
    classifications: [
      {
        id: 'c-1',
        classification: 'internal',
        internalComment: 'Relevo que no llegó a horario',
        clientNote: null,
        reason: null,
        decidedAt: '2026-10-20T00:30:00.000Z',
        decidedBy: { firstName: 'Laura', lastName: 'Gómez' },
      },
    ],
  };

  jest.mocked(apiGet).mockImplementation((path: string) => {
    if (path === '/incidentes/incident-1') return Promise.resolve(classifiedIncident);
    return Promise.resolve([]);
  });
  jest.mocked(apiPost).mockResolvedValue({
    classificationStatus: 'client_visible',
    decidedAt: '2026-10-20T01:30:00.000Z',
  });

  renderWithQueryClient(
    <MemoryRouter>
      <IncidentDetailPage />
    </MemoryRouter>,
  );

  expect(await screen.findByText('Reclasificar')).toBeInTheDocument();
  expect(screen.getByText('Historial de clasificación')).toBeInTheDocument();
  expect(screen.getByText(/Laura Gómez/)).toBeInTheDocument();
  expect(screen.getByText('Comentario interno: Relevo que no llegó a horario')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Reclasificar' }));
  expect(screen.getByRole('heading', { name: 'Reclasificar incidente' })).toBeInTheDocument();
  const reclassifyForm = screen.getByRole('form', { name: 'Reclasificar incidente' });

  // Intento de envío sin motivo falla
  fireEvent.change(screen.getByLabelText('Comentario interno'), {
    target: { value: 'Se reclasifica a visible tras confirmar rotura.' },
  });
  fireEvent.submit(reclassifyForm);
  expect(await screen.findByText(/>=5 characters/)).toBeInTheDocument();

  // Completar motivo válido
  fireEvent.change(screen.getByLabelText('Motivo del cambio'), {
    target: { value: 'El cliente solicitó el informe de la incidencia.' },
  });

  fireEvent.submit(reclassifyForm);
  await waitFor(() => {
    expect(jest.mocked(apiPost)).toHaveBeenCalledWith(
      '/incidentes/incident-1/reclasificar',
      {
        classification: 'client_visible',
        internalComment: 'Se reclasifica a visible tras confirmar rotura.',
        reason: 'El cliente solicitó el informe de la incidencia.',
      },
      expect.anything(),
      expect.anything(),
    );
  });
});

it('al elegir un incidente de la cola muestra su detalle al costado', async () => {
  jest.mocked(apiGet).mockImplementation((path: string) => {
    if (path === '/incidentes/incident-1') return Promise.resolve(detailIncident);
    return Promise.resolve([incident]);
  });
  renderWithQueryClient(
    <MemoryRouter>
      <IncidentsQueuePage />
    </MemoryRouter>,
  );
  expect(
    await screen.findByText('Elegí un incidente de la lista para ver el detalle.'),
  ).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: /Intrusión · Predio A/ }));
  expect(await screen.findByText('Portón forzado en lateral este')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clasificar' }));
  expect(screen.getByRole('radio', { name: /Interno/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirmar clasificación' })).toBeInTheDocument();
});
