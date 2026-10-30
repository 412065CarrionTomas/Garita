import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import type * as ReactRouter from 'react-router';
import { apiGet, apiPost } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { PanicBanner } from './panic-banner';
import { PanicDetailPage } from './panic-detail-page';
import { PanicListPage } from './panic-list-page';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn(), apiPost: jest.fn() }));
jest.mock('@/features/mapa/site-location-map', () => ({
  ClientSitesMap: () => <p>Mapa de la alerta</p>,
}));
jest.mock('react-router', () => ({
  ...jest.requireActual<typeof ReactRouter>('react-router'),
  useParams: () => ({ id: '019cbfe6-bdb0-7000-8000-123456789012' }),
}));

const alert = {
  id: '019cbfe6-bdb0-7000-8000-123456789012',
  status: 'active' as const,
  channel: 'sms' as const,
  triggeredAt: '2026-10-13T06:10:00.000Z',
  receivedAt: '2026-10-13T06:25:00.000Z',
  confirmedAt: null,
  escalatedAt: null,
  site: { id: 'site', name: 'Depósito Ruta 9' },
  guard: { name: 'Pedro Díaz', phone: '+5493511234567' },
  timezone: 'America/Argentina/Buenos_Aires',
  authenticated: true,
  latitude: -31.4,
  longitude: -64.2,
  accuracyMeters: 20,
  confirmedBy: null,
  resolvedAt: null,
  resolvedBy: null,
  outcome: null,
  resolutionComment: null,
  smsDeliveries: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

it('anuncia una alerta activa con texto, ícono, enlace y control para activar sonido', () => {
  renderWithQueryClient(
    <MemoryRouter>
      <PanicBanner alerts={[alert]} count={1} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Alerta de pánico · 1 activa');
  expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  expect(screen.getByRole('link', { name: 'Atender alerta' })).toHaveAttribute(
    'href',
    `/alertas-panico/${alert.id}`,
  );
  expect(screen.getByRole('button', { name: 'Activar sonido de alertas' })).toBeEnabled();
});

it('repite el tono y lo detiene cuando ya no hay activas', async () => {
  jest.useFakeTimers();
  const start = jest.fn();
  const close = jest.fn(() => Promise.resolve());
  const audio = {
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: jest.fn(() => Promise.resolve()),
    close,
    createOscillator: () => ({
      connect: jest.fn(),
      frequency: { value: 0 },
      start,
      stop: jest.fn(),
    }),
    createGain: () => ({
      connect: jest.fn(),
      gain: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
    }),
  };
  const previous = window.AudioContext;
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    writable: true,
    value: jest.fn(() => audio),
  });
  try {
    const view = renderWithQueryClient(
      <MemoryRouter>
        <PanicBanner alerts={[alert]} count={1} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Activar sonido de alertas' }));
    await waitFor(() => {
      expect(localStorage.getItem('garita-panic-sound')).toBe('enabled');
    });
    const initial = start.mock.calls.length;
    const { act } = await import('@testing-library/react');
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(start).toHaveBeenCalledTimes(initial + 2);
    view.rerender(
      <MemoryRouter>
        <PanicBanner alerts={[]} count={0} />
      </MemoryRouter>,
    );
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(start).toHaveBeenCalledTimes(initial + 2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    view.unmount();
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: previous,
    });
    jest.useRealTimers();
  }
});

it('recupera el sonido recordado al remontar los efectos en modo estricto', () => {
  localStorage.setItem('garita-panic-sound', 'enabled');
  const previous = window.AudioContext;
  const start = jest.fn();
  const contexts: { state: string }[] = [];
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    writable: true,
    value: jest.fn(() => {
      const audio = {
        state: 'running',
        currentTime: 0,
        destination: {},
        close: () => {
          audio.state = 'closed';
          return Promise.resolve();
        },
        createOscillator: () => ({
          connect: jest.fn(),
          frequency: { value: 0 },
          start,
          stop: jest.fn(),
        }),
        createGain: () => ({
          connect: jest.fn(),
          gain: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
        }),
      };
      contexts.push(audio);
      return audio;
    }),
  });
  try {
    const view = render(
      <StrictMode>
        <MemoryRouter>
          <PanicBanner alerts={[alert]} count={1} />
        </MemoryRouter>
      </StrictMode>,
    );
    expect(start).toHaveBeenCalledTimes(2);
    expect(contexts.map((audio) => audio.state)).toEqual(['closed', 'running']);
    expect(
      screen.queryByRole('button', { name: 'Activar sonido de alertas' }),
    ).not.toBeInTheDocument();
    view.unmount();
  } finally {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: previous,
    });
  }
});

it('muestra las dos horas y el canal, teléfono, y exige confirmar antes de resolver', async () => {
  jest.mocked(apiGet).mockResolvedValue(alert);
  renderWithQueryClient(
    <MemoryRouter>
      <PanicDetailPage />
    </MemoryRouter>,
  );
  expect(
    await screen.findByText('Enviada por SMS a las 03:10, recibida por la plataforma a las 03:25'),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Llamar al vigilador/ })).toHaveAttribute(
    'href',
    'tel:+5493511234567',
  );
  expect(screen.getByRole('button', { name: 'Resolver alerta' })).toBeDisabled();
  expect(screen.getByText('Primero confirmá la alerta para poder resolverla.')).toBeInTheDocument();
});

it('confirma y refresca el estado del detalle', async () => {
  const confirmed = {
    ...alert,
    status: 'confirmed',
    confirmedAt: alert.receivedAt,
    confirmedBy: { id: 'laura', name: 'Laura Gómez' },
  };
  jest.mocked(apiGet).mockResolvedValueOnce(alert).mockResolvedValue(confirmed);
  jest.mocked(apiPost).mockResolvedValue(confirmed);
  renderWithQueryClient(
    <MemoryRouter>
      <PanicDetailPage />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Confirmar alerta' }));
  expect(await screen.findByText(/Laura Gómez/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Resolver alerta' })).toBeEnabled();
  expect(apiPost).toHaveBeenCalledWith(
    `/alertas-panico/${alert.id}/confirmar`,
    {},
    expect.anything(),
    expect.anything(),
  );
});

it('valida el diálogo y resuelve una alerta confirmada por otra persona', async () => {
  jest.mocked(apiGet).mockResolvedValue({
    ...alert,
    status: 'confirmed',
    confirmedAt: alert.receivedAt,
    confirmedBy: { id: 'laura', name: 'Laura Gómez' },
  });
  jest.mocked(apiPost).mockResolvedValue({ ...alert, status: 'resolved' });
  renderWithQueryClient(
    <MemoryRouter>
      <PanicDetailPage />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Resolver alerta' }));
  expect(screen.getByRole('dialog', { name: 'Resolver alerta de pánico' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar resolución' }));
  expect(screen.getByText('Elegí un resultado.')).toBeInTheDocument();
  expect(apiPost).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'test' } });
  fireEvent.change(screen.getByLabelText('Comentario'), { target: { value: 'cort' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar resolución' }));
  expect(screen.getByLabelText('Comentario')).toHaveAttribute('aria-invalid', 'true');
  expect(apiPost).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Comentario'), {
    target: { value: 'Prueba de capacitación' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar resolución' }));
  await waitFor(() => {
    expect(apiPost).toHaveBeenCalledWith(
      `/alertas-panico/${alert.id}/resolver`,
      { outcome: 'test', comment: 'Prueba de capacitación' },
      expect.anything(),
      expect.anything(),
    );
  });
});

it('filtra el historial por predio y estado', async () => {
  jest
    .mocked(apiGet)
    .mockImplementation((path) =>
      Promise.resolve(
        path === '/predios'
          ? [alert.site]
          : { items: [alert], total: 1, activeCount: 1, page: 1, pageSize: 25 },
      ),
    );
  renderWithQueryClient(
    <MemoryRouter>
      <PanicListPage />
    </MemoryRouter>,
  );
  await screen.findByText('Depósito Ruta 9 · Pedro Díaz');
  fireEvent.change(screen.getByLabelText('Predio'), { target: { value: 'site' } });
  fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'confirmed' } });
  await waitFor(() => {
    expect(apiGet).toHaveBeenCalledWith(
      '/alertas-panico?pagina=1&estado=confirmed&predio=site',
      expect.anything(),
    );
  });
});

it('muestra la indicación preparada para una alerta SMS no verificada', async () => {
  jest.mocked(apiGet).mockResolvedValue({ ...alert, authenticated: false });
  renderWithQueryClient(
    <MemoryRouter>
      <PanicDetailPage />
    </MemoryRouter>,
  );
  expect(
    await screen.findByText('No verificada. Atendé la alerta igualmente.'),
  ).toBeInTheDocument();
});
