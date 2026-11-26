import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { ThemeProvider } from '@/lib/theme';
import { RoleLayout } from '@/features/auth/routes';
import type { noticeSchema } from '@garita/shared';
import type { z } from 'zod';
import { NoticeDetailPage } from './notice-detail-page';
import { NoticesPage } from './notices-page';
import { CloseWithoutDataDialog } from './close-without-data-dialog';

let mockDetail = false;
jest.mock('react-router', () => ({
  ...jest.requireActual<Record<string, unknown>>('@/test/react-router'),
  useParams: () => ({ id: 'n2' }),
  Outlet: () => (mockDetail ? <NoticeDetailPage /> : <NoticesPage />),
}));
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
jest.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({
    user: { role: 'supervisor', firstName: 'Ana', lastName: 'López', company: { name: 'Norte' } },
    loading: false,
    logout: jest.fn(),
  }),
}));
jest.mock('@/features/notificaciones/notification-control', () => ({
  NotificationControl: () => null,
}));
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
const notice: z.infer<typeof noticeSchema> = {
  id: 'n1',
  companyId: 'company1',
  siteId: 'p1',
  shiftId: 's1',
  kind: 'round_missed',
  subjectId: 'w1',
  key: 'round_missed:w1',
  status: 'open',
  resolution: null,
  details: {
    missingPoints: ['Portón norte'],
    severityLevel: 'media',
    occurredAt: '2030-01-02T01:00:00Z',
  },
  createdAt: '2030-01-02T01:05:00Z',
  resolvedAt: null,
  seenAt: null,
  site: { name: 'Depósito Ruta 9' },
  shift: { startsAt: '2030-01-01T20:00:00Z', endsAt: '2030-01-02T08:00:00Z' },
};
const unsynced: z.infer<typeof noticeSchema> = {
  ...notice,
  id: 'n2',
  kind: 'shift_unsynced',
  subjectId: 's2',
  shiftId: 's2',
  siteId: 'p2',
  site: { name: 'Campo Los Álamos' },
  key: 'shift_unsynced:s2',
  details: null,
};
let current = [notice, unsynced];

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));
  mockDetail = false;
  mockListeners.clear();
  current = [notice, unsynced];
  jest.mocked(apiGet).mockImplementation((path) => {
    if (path === '/predios')
      return Promise.resolve([
        { id: 'p1', name: 'Depósito Ruta 9' },
        { id: 'p2', name: 'Campo Los Álamos' },
      ] as never);
    if (path.startsWith('/avisos?')) {
      const params = new URLSearchParams(path.split('?')[1]);
      const items = current.filter(
        (item) =>
          (!params.get('estado') || item.status === params.get('estado')) &&
          (!params.get('tipo') || item.kind === params.get('tipo')) &&
          (!params.get('predio') || item.siteId === params.get('predio')),
      );
      return Promise.resolve({
        items,
        openCount: current.filter((item) => item.status === 'open').length,
        unseenOpenCount: current.filter((item) => item.status === 'open' && !item.seenAt).length,
      } as never);
    }
    if (path.startsWith('/avisos/'))
      return Promise.resolve(current.find((item) => item.id === path.split('/')[2]) as never);
    if (path === '/ventanas-ronda/en-revision')
      return Promise.resolve({ items: [], count: 0 } as never);
    if (path === '/incidentes/cola/cantidad') return Promise.resolve({ count: 0 } as never);
    return Promise.resolve([] as never);
  });
  jest.mocked(apiPost).mockImplementation((path) => {
    const id = path.split('/')[2];
    current = current.map((item) =>
      item.id === id ? { ...item, seenAt: '2030-01-02T02:00:00Z' } : item,
    );
    return Promise.resolve(current.find((item) => item.id === id) as never);
  });
});

it('muestra tipo, predio, detalle y fechas; filtra e incluye historial', async () => {
  renderWithQueryClient(
    <MemoryRouter>
      <NoticesPage />
    </MemoryRouter>,
  );
  const table = await screen.findByRole('table', { name: 'Avisos' });
  const row = within(table)
    .getByRole('link', { name: /Ronda incumplida/ })
    .closest('tr');
  if (!row) throw new Error('Falta la fila del aviso');
  expect(row).toHaveTextContent('Depósito Ruta 9');
  expect(row).toHaveTextContent('Faltan: Portón norte');
  expect(within(row).getByText('Nuevo')).toBeInTheDocument();
  expect(within(row).getByRole('link', { name: /Ronda incumplida/ })).toHaveAttribute(
    'href',
    '/avisos/n1',
  );
  expect(screen.getByRole('button', { name: 'Abiertos (2)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tipo' }), 'shift_unsynced');
  await waitFor(() => {
    expect(screen.queryByRole('link', { name: /Ronda incumplida/ })).not.toBeInTheDocument();
  });
  expect(await screen.findByRole('link', { name: /Turno sin sincronizar/ })).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Predio' }), 'p1');
  expect(await screen.findByText('No hay avisos para estos filtros')).toBeInTheDocument();
  current = [
    {
      ...unsynced,
      status: 'resolved',
      resolution: 'closed_without_data',
      resolvedAt: '2030-01-02T03:00:00Z',
    },
  ];
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Predio' }), '');
  await userEvent.click(screen.getByRole('button', { name: 'Resueltos' }));
  expect(await screen.findByText('Resuelto: Cerrado sin datos')).toBeInTheDocument();
  expect(apiGet).toHaveBeenCalledWith(
    '/avisos?estado=resolved&tipo=shift_unsynced&pagina=1&porPagina=10',
    expect.anything(),
  );
});

it('llega filtrado desde otra pantalla', async () => {
  // El router de prueba lee los parámetros de la URL de la ventana.
  window.history.pushState({}, '', '/avisos?tipo=shift_unsynced');
  renderWithQueryClient(
    <MemoryRouter initialEntries={['/avisos?tipo=shift_unsynced']}>
      <NoticesPage />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('link', { name: /Turno sin sincronizar/ })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Tipo' })).toHaveValue('shift_unsynced');
  window.history.pushState({}, '', '/');
});

it('refresca y anuncia un aviso nuevo sin recargar; actualizado mueve al historial', async () => {
  current = [];
  renderWithQueryClient(
    <MemoryRouter initialEntries={['/avisos']}>
      <ThemeProvider>
        <RoleLayout />
      </ThemeProvider>
    </MemoryRouter>,
  );
  await screen.findByText('No hay avisos para estos filtros');
  await waitFor(() => {
    expect(mockListeners.has('aviso.nuevo')).toBe(true);
  });
  current = [notice];
  act(() => {
    mockListeners.get('aviso.nuevo')?.({ kind: 'round_missed', siteId: 'p1', shiftId: 's1' });
  });
  expect(await screen.findByRole('link', { name: /Ronda incumplida/ })).toBeInTheDocument();
  expect(screen.getByText('Aviso nuevo: ronda incumplida en Depósito Ruta 9')).toHaveAttribute(
    'aria-live',
    'polite',
  );
  expect(await screen.findByRole('button', { name: 'Pendientes (1)' })).toBeInTheDocument();
  current = [];
  act(() => {
    mockListeners.get('aviso.actualizado')?.({ noticeId: 'n1', siteId: 'p1' });
  });
  expect(await screen.findByText('No hay avisos para estos filtros')).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Pendientes' })).toBeInTheDocument();
});

it('al entrar desde una notificación marca visto y ofrece cierre desde el aviso', async () => {
  mockDetail = true;
  renderWithQueryClient(
    <MemoryRouter initialEntries={['/avisos/n2']}>
      <ThemeProvider>
        <RoleLayout />
      </ThemeProvider>
    </MemoryRouter>,
  );
  expect(
    await screen.findByRole('heading', { name: 'Turno sin sincronizar en Campo Los Álamos' }),
  ).toBeInTheDocument();
  await waitFor(() => {
    expect(apiPost).toHaveBeenCalledWith(
      '/avisos/n2/marcar-visto',
      {},
      expect.anything(),
      expect.anything(),
    );
  });
  await userEvent.click(screen.getByRole('button', { name: 'Cerrar sin datos' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('rechaza 4 caracteres y falta de confirmación, envía el motivo válido y conserva el 409', async () => {
  jest
    .mocked(apiPost)
    .mockRejectedValueOnce(
      new ApiError('conflicto', 409, { message: 'Los datos acaban de llegar' }),
    );
  const onClose = jest.fn();
  renderWithQueryClient(<CloseWithoutDataDialog shiftId="s1" onClose={onClose} />);
  const dialog = screen.getByRole('dialog');
  const submit = within(dialog).getByRole('button', { name: 'Cerrar sin datos' });
  const reason = screen.getByLabelText('Motivo del cierre');
  await userEvent.type(reason, 'abcd');
  await userEvent.click(submit);
  expect(screen.getByRole('alert')).toHaveTextContent('entre 5 y 500');
  expect(apiPost).not.toHaveBeenCalled();
  await userEvent.clear(reason);
  await userEvent.type(reason, 'Celular roto, se pierden los registros');
  await userEvent.click(submit);
  expect(screen.getByRole('alert')).toHaveTextContent('Confirmá');
  expect(apiPost).not.toHaveBeenCalled();
  await userEvent.click(screen.getByLabelText('Confirmo el cierre sin datos de este turno'));
  await userEvent.click(submit);
  expect(await screen.findByRole('alert')).toHaveTextContent('Los datos acaban de llegar');
  expect(apiPost).toHaveBeenCalledWith(
    '/turnos/s1/cerrar-sin-datos',
    { reason: 'Celular roto, se pierden los registros' },
    expect.anything(),
    expect.anything(),
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(reason).toHaveValue('Celular roto, se pierden los registros');
  jest.mocked(apiPost).mockResolvedValueOnce({
    shiftId: 's1',
    closedWithoutDataAt: '2030-01-02T02:00:00Z',
    closedWithoutDataById: 'u1',
    reason: 'Celular roto',
  });
  await userEvent.click(submit);
  await waitFor(() => {
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

it('no envía un motivo de 501 caracteres ni espacios', async () => {
  renderWithQueryClient(<CloseWithoutDataDialog shiftId="s1" onClose={jest.fn()} />);
  const reason = screen.getByLabelText('Motivo del cierre');
  for (const value of [' '.repeat(5), 'a'.repeat(501)]) {
    fireEvent.change(reason, { target: { value } });
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sin datos' }));
    expect(apiPost).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('entre 5 y 500');
  }
});
