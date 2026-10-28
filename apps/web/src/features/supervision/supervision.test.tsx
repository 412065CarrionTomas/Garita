import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { SupervisionPage } from './supervision-page';
import { ShiftDetailPage } from './shift-detail-page';
import { time } from './contracts';
import { useRealtime } from '@/lib/realtime';
import { ReassignDialog } from './reassign-dialog';

const mockListeners = new Map<string, (value?: unknown) => void>();
const mockSocket = {
  on: jest.fn((name: string, listener: (value?: unknown) => void) => {
    mockListeners.set(name, listener);
  }),
  connect: jest.fn(),
  disconnect: jest.fn(),
  removeAllListeners: jest.fn(),
};
jest.mock('socket.io-client', () => ({ io: jest.fn(() => mockSocket) }));

jest.mock('@/lib/api-client', () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(),
  ApiError: class extends Error {
    status?: number;
    body: unknown;
    constructor(message: string, status?: number, body?: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
}));
jest.mock('react-router', () => ({
  ...jest.requireActual<Record<string, unknown>>('@/test/react-router'),
  useParams: () => ({ id: 's1' }),
}));

const row = {
  id: 's1',
  site: { id: 'p1', name: 'Depósito Ruta 9' },
  startsAt: '2030-01-01T20:00:00Z',
  endsAt: '2030-01-02T08:00:00Z',
  status: 'in_progress',
  syncStatus: { status: 'sin_contacto', since: '2030-01-01T22:05:00Z', pendingCount: 2 },
  assignment: { guard: { firstName: 'Pedro', lastName: 'Díaz' } },
  windows: {},
};
const detail = {
  id: 's1',
  site: { ...row.site, connectivityType: 'without_signal', minutesToSignal: 200 },
  status: 'uncovered',
  scheduled: { startsAt: row.startsAt, endsAt: row.endsAt },
  actual: {
    startedAt: row.startsAt,
    closedAt: '2030-01-02T01:30:00Z',
    closedEarly: true,
    closeReason: 'Me descompuse',
    closedBy: null,
  },
  phoneWithoutNfc: true,
  assignments: [
    {
      id: 'a1',
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      isCurrent: true,
      result: 'closed_early',
      reassignedAt: null,
      guard: row.assignment.guard,
      assignedBy: { firstName: 'Ana', lastName: 'López' },
    },
  ],
  rounds: [{ id: 'r1', name: 'Perimetral' }],
  windows: [
    {
      id: 'w1',
      roundId: 'r1',
      windowIndex: 0,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      status: 'pending_sync',
      severityLevel: null,
      recordedCount: 1,
      expectedCount: 2,
    },
  ],
  points: [
    { id: 'c1', name: 'Portón', latitude: -34, longitude: -58, registered: true },
    { id: 'c2', name: 'Patio', latitude: -34, longitude: -58, registered: false },
  ],
  route: [{ checkpointId: 'c1', latitude: -34, longitude: -58, occurredAtDevice: row.startsAt }],
  records: [
    {
      id: 'record1',
      checkpointId: 'c1',
      occurredAtDevice: row.startsAt,
      flags: [{ id: 'f1', reason: 'Fuera de rango', severity: 'media' }],
    },
    {
      id: 'record2',
      checkpointId: 'c1',
      occurredAtDevice: row.startsAt,
      flags: [{ id: 'f2', reason: 'Ubicación simulada', severity: 'grave' }],
    },
  ],
  rejectedAttempts: [
    {
      id: 'i1',
      method: 'qr',
      reason: 'Código regenerado',
      occurredAtDevice: row.startsAt,
      highlighted: true,
    },
  ],
  canCover: true,
};

beforeEach(() => {
  jest
    .mocked(apiGet)
    .mockImplementation((path) =>
      Promise.resolve(
        (path.includes('/detalle')
          ? detail
          : path.includes('/reemplazos')
            ? [{ id: 'u2', firstName: 'Juan', lastName: 'Pérez' }]
            : [row]) as never,
      ),
    );
});

it('muestra estados, hora de contacto y filtros operables con teclado', async () => {
  renderWithQueryClient(
    <MemoryRouter>
      <SupervisionPage />
    </MemoryRouter>,
  );
  expect(
    await screen.findByText(`Sin contacto desde ${time(row.syncStatus.since)} (quedan 2 eventos)`),
  ).toBeInTheDocument();
  expect(screen.getByText('En curso', { selector: '[data-slot="badge"]' })).toBeInTheDocument();
  const status = screen.getByLabelText('Estado');
  await userEvent.selectOptions(status, 'uncovered');
  expect(screen.getByText('No hay turnos para estos filtros')).toBeInTheDocument();
  await userEvent.selectOptions(status, 'in_progress');
  expect(screen.getByRole('link', { name: 'Ver detalle' })).toHaveAttribute(
    'href',
    '/supervision/turnos/s1',
  );
});

it.each([
  ['without_guard', 'Sin vigilador'],
  ['no_show', 'No presentado'],
  ['uncovered', 'Sin cobertura'],
])('destaca %s', async (status, label) => {
  jest.mocked(apiGet).mockResolvedValue([{ ...row, status, syncStatus: null }] as never);
  renderWithQueryClient(
    <MemoryRouter>
      <SupervisionPage />
    </MemoryRouter>,
  );
  expect(await screen.findByText(label)).toBeInTheDocument();
});

it.each([
  ['sincronizando', 'Sincronizando (quedan 2 eventos)'],
  ['esperando_hasta', `Esperando sincronización hasta ${time('2030-01-01T18:20:00Z')}`],
])('muestra %s', async (status, expected) => {
  jest.mocked(apiGet).mockResolvedValue([
    {
      ...row,
      syncStatus:
        status === 'sincronizando'
          ? { status, pendingCount: 2 }
          : { status, deadline: '2030-01-01T18:20:00Z' },
    },
  ] as never);
  renderWithQueryClient(
    <MemoryRouter>
      <SupervisionPage />
    </MemoryRouter>,
  );
  expect(await screen.findByText(expected)).toBeInTheDocument();
});

it('muestra ventanas, recorrido, rechazos y filtra marcas por gravedad', async () => {
  renderWithQueryClient(
    <MemoryRouter initialEntries={['/supervision/turnos/s1']}>
      <Routes>
        <Route path="/supervision/turnos/:id" element={<ShiftDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole('heading', { name: 'Rondas y ventanas' })).toBeInTheDocument();
  expect(screen.getByText('Pendiente de sincronizar')).toBeInTheDocument();
  expect(screen.getByText(/Sin cobertura desde/)).toHaveTextContent('Me descompuse');
  expect(screen.getByRole('list', { name: 'Puntos del recorrido' })).toHaveTextContent(
    '0 m del punto configurado',
  );
  expect(screen.getByText(/Código regenerado/)).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('Solo marcados'));
  await userEvent.selectOptions(screen.getByLabelText('Gravedad'), 'media');
  await waitFor(() => {
    expect(screen.getByText(/Fuera de rango/)).toBeInTheDocument();
  });
  expect(screen.queryByText(/Ubicación simulada/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cubrir el resto' })).toBeEnabled();
  expect(screen.getByText(/Cerrada antes de hora/)).toBeInTheDocument();
});

it('permite elegir reemplazo con teclado y advierte sobre el predio sin señal', async () => {
  jest.mocked(apiPost).mockResolvedValue({ shiftId: 's1', assignmentId: 'a2' });
  renderWithQueryClient(
    <MemoryRouter>
      <ShiftDetailPage />
    </MemoryRouter>,
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Cubrir el resto' }));
  fireEvent.change(screen.getByLabelText('Inicio del reemplazo (opcional: ahora)'), {
    target: { value: '2030-01-02T04:00' },
  });
  await screen.findByRole('option', { name: 'Juan Pérez' });
  await userEvent.selectOptions(await screen.findByLabelText('Vigilador'), 'u2');
  expect(screen.getByText(/podría no llegar al predio/)).toBeInTheDocument();
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Cubrir el resto' }),
  );
  await waitFor(() => {
    expect(apiPost).toHaveBeenCalledWith(
      '/turnos/s1/reasignar',
      { guardId: 'u2', startsAt: new Date('2030-01-02T04:00').toISOString() },
      expect.anything(),
      expect.anything(),
    );
  });
});

it('valida el horario, mantiene el foco en el diálogo y permite cancelar con Escape', async () => {
  const onOpenChange = jest.fn();
  renderWithQueryClient(
    <ReassignDialog
      shiftId="s1"
      endsAt={row.endsAt}
      minutesToSignal={null}
      covering={false}
      open
      onOpenChange={onOpenChange}
    />,
  );
  const guard = await screen.findByLabelText('Vigilador');
  await waitFor(() => {
    expect(guard).toBeEnabled();
  });
  guard.focus();
  expect(guard).toHaveFocus();
  await userEvent.selectOptions(guard, 'u2');
  await userEvent.tab();
  const start = screen.getByLabelText('Inicio del reemplazo (opcional: ahora)');
  expect(start).toHaveFocus();
  fireEvent.change(start, { target: { value: '2030-01-02T09:00' } });
  expect(start).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Elegí una hora entre ahora y el fin del turno.',
  );
  expect(screen.getByRole('button', { name: 'Reasignar' })).toBeDisabled();
  await userEvent.keyboard('{Escape}');
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('muestra el motivo de la carrera y conserva el formulario', async () => {
  jest
    .mocked(apiPost)
    .mockRejectedValueOnce(
      new ApiError('conflicto', 409, { message: 'El vigilador acaba de iniciar el turno' }),
    );
  renderWithQueryClient(
    <ReassignDialog
      shiftId="s1"
      endsAt={row.endsAt}
      minutesToSignal={null}
      covering={false}
      open
      onOpenChange={jest.fn()}
    />,
  );
  await screen.findByRole('option', { name: 'Juan Pérez' });
  await userEvent.selectOptions(await screen.findByLabelText('Vigilador'), 'u2');
  await userEvent.click(screen.getByRole('button', { name: 'Reasignar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'El vigilador acaba de iniciar el turno',
  );
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('muestra la advertencia del servidor después de confirmar y evita otro envío', async () => {
  jest
    .mocked(apiPost)
    .mockResolvedValueOnce({ shiftId: 's1', assignmentId: 'a2', warning: 'replacement_late' });
  renderWithQueryClient(
    <ReassignDialog
      shiftId="s1"
      endsAt={row.endsAt}
      minutesToSignal={null}
      covering={false}
      open
      onOpenChange={jest.fn()}
    />,
  );
  await screen.findByRole('option', { name: 'Juan Pérez' });
  await userEvent.selectOptions(await screen.findByLabelText('Vigilador'), 'u2');
  await userEvent.click(screen.getByRole('button', { name: 'Reasignar' }));
  expect(await screen.findByText(/Turno reasignado/)).toHaveTextContent('podría no llegar');
  expect(screen.getByRole('button', { name: 'Reasignar' })).toBeDisabled();
});

it('actualiza el punto y la ventana al llegar un registro sin recargar la página', async () => {
  let current = detail;
  jest.mocked(apiGet).mockImplementation(() => Promise.resolve(current as never));
  function LiveDetail() {
    useRealtime(true);
    return <ShiftDetailPage />;
  }
  renderWithQueryClient(
    <MemoryRouter>
      <LiveDetail />
    </MemoryRouter>,
  );
  expect(await screen.findByText('Pendiente de sincronizar')).toBeInTheDocument();
  expect(screen.getByText('Pendiente', { selector: '[data-slot="badge"]' })).toBeInTheDocument();
  const firstWindow = detail.windows[0];
  if (!firstWindow) throw new Error('Falta ventana en el detalle de prueba');
  current = {
    ...detail,
    windows: [{ ...firstWindow, status: 'complete', recordedCount: 2 }],
    points: detail.points.map((point) => ({ ...point, registered: true })),
  };
  act(() => {
    mockListeners.get('registro.nuevo')?.({
      shiftId: 's1',
      siteId: 'p1',
      checkpointId: 'c2',
      recordId: 'record3',
    });
  });
  await waitFor(() => {
    expect(screen.getByText('Completa')).toBeInTheDocument();
  });
  expect(screen.getAllByText('Registrado')).toHaveLength(2);
});

it('soporta 100 turnos simultáneos y filtra por predio', async () => {
  const hundredRows = Array.from({ length: 100 }, (_, index) => ({
    ...row,
    id: `s-${index}`,
    site: { id: `p-${index % 5}`, name: `Predio ${index % 5}` },
  }));
  jest.mocked(apiGet).mockResolvedValue(hundredRows);
  renderWithQueryClient(
    <MemoryRouter>
      <SupervisionPage />
    </MemoryRouter>,
  );
  expect(await screen.findAllByRole('heading', { level: 2 })).toHaveLength(100);
  const siteSelect = screen.getByLabelText('Predio');
  await userEvent.selectOptions(siteSelect, 'p-0');
  expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(20);
});
