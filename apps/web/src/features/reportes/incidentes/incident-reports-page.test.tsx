import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { computeIncidentReport, computeResponseTimes, computePanicReport } from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { renderWithQueryClient } from '@/test/render';
import { IncidentReportsPage } from './incident-reports-page';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn() }));
jest.mock('@/features/auth/auth-context', () => ({ useAuth: jest.fn() }));

const period = { desde: '2026-10-01', hasta: '2026-11-01', timezone: 'UTC' };
const incidentReport = {
  ...period,
  ...computeIncidentReport(
    [
      {
        type: 'intrusion',
        classificationStatus: 'internal',
        severity: 'high',
        site: { id: 'p', name: 'Depósito' },
        // Jueves 1/10/2026, 02:00 UTC.
        occurredAtDevice: '2026-10-01T02:00:00Z',
        trustedAt: null,
        receivedAt: '2026-10-01T02:00:00Z',
      },
    ],
    'UTC',
    new Date('2026-10-03T02:00:00Z'),
  ),
  previous: { desde: '2026-08-31', hasta: '2026-10-01', total: 4, highSeverity: 0 },
  openFollowUpsTotal: 1,
  openFollowUps: [
    {
      id: 'i1',
      type: 'intrusion',
      site: { id: 'p', name: 'Depósito' },
      severity: 'high',
      openedAt: '2026-10-01T03:00:00.000Z',
      ageMs: 30 * 3_600_000,
      lastAction: 'Se pidió presupuesto del cerco',
    },
  ],
  filters: { sites: [{ id: 'p', name: 'Depósito' }], clients: [{ id: 'c', name: 'Cliente' }] },
};
const response = computeResponseTimes(
  [
    {
      site: { id: 'p', name: 'Depósito' },
      triggeredAt: '2026-10-01T03:10:00Z',
      confirmedAt: '2026-10-01T03:27:00Z',
      confirmedBy: { id: 's', name: 'Ana' },
      escalatedAt: '2026-10-01T03:26:00Z',
    },
  ],
  [],
  [],
);
const emptyTimes = computeResponseTimes([], [], []).totals;
let role: 'admin' | 'supervisor';
beforeEach(() => {
  role = 'admin';
  window.history.pushState({}, '', '/incidentes-y-respuesta');
  jest
    .mocked(useAuth)
    .mockImplementation(() => ({ user: { role }, loading: false }) as ReturnType<typeof useAuth>);
  jest.mocked(apiGet).mockImplementation((path, schema) => {
    const respond = (data: unknown) => Promise.resolve(schema.parse(data));
    if (path.includes('/incidentes/detalle'))
      return respond({
        total: 1,
        page: 1,
        pageSize: 25,
        items: [
          {
            id: 'i1',
            site: { id: 'p', name: 'Depósito' },
            type: 'intrusion',
            classificationStatus: 'internal',
            severity: 'high',
            followUpStatus: 'open',
            occurredAt: '2026-10-01T02:00:00.000Z',
          },
        ],
      });
    if (path.includes('/tiempos-de-respuesta'))
      return respond(
        role === 'admin'
          ? { ...period, ...response, previousTotals: emptyTimes }
          : {
              ...period,
              totals: response.totals,
              previousTotals: emptyTimes,
              bySite: response.bySite,
              own: response.bySupervisor[0],
            },
      );
    if (path.includes('/panico'))
      return respond({
        ...period,
        ...computePanicReport([{ outcome: 'false_alarm', channel: 'sms' }]),
        previous: { total: 2, falseAlarmProportion: 0.5 },
      });
    return respond(incidentReport);
  });
});
function renderPage() {
  return renderWithQueryClient(
    <MemoryRouter>
      <IncidentReportsPage />
    </MemoryRouter>,
  );
}

it('muestra cifras contra el período anterior, sin el aviso de pendientes repetido', async () => {
  renderPage();
  const kpis = await screen.findByText('Gravedad alta');
  expect(kpis).toBeInTheDocument();
  expect(screen.getByText('−3 respecto del período anterior')).toBeInTheDocument();
  expect(screen.getByText('+1 respecto del período anterior')).toBeInTheDocument();
  expect(screen.getByText('+50 pp respecto del período anterior')).toBeInTheDocument();
  expect(screen.queryByText(/pendientes de clasificar/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Rondas incumplidas/)).not.toBeInTheDocument();
});

it('el mapa de calor abre el detalle del día y franja en un panel lateral', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Jue 02–04 h: 1 incidentes' }));
  expect(await screen.findByRole('dialog', { name: 'Jue 02–04 h' })).toBeInTheDocument();
  expect(apiGet).toHaveBeenCalledWith(
    expect.stringMatching(/\/reportes\/incidentes\/detalle\?.*dia=3&franja=2/),
    expect.anything(),
  );
  expect(await screen.findByRole('link', { name: /Intrusión/ })).toHaveAttribute(
    'href',
    '/incidentes/i1',
  );
});

it('lista el seguimiento abierto y los tiempos en una sola tabla por predio o supervisor', async () => {
  const user = userEvent.setup();
  renderPage();
  expect(
    await screen.findByRole('table', { name: 'Incidentes con seguimiento abierto' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Se pidió presupuesto del cerco')).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Tiempos por predio' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Por supervisor' }));
  expect(screen.getByRole('table', { name: 'Tiempos por supervisor' })).toBeInTheDocument();
  expect(screen.getByText('Ana')).toBeInTheDocument();
});

it('el supervisor ve sus propios tiempos', async () => {
  role = 'supervisor';
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Mis tiempos' }));
  expect(screen.getByText('Ana')).toBeInTheDocument();
});

it('los filtros van en una sola barra y se aplican al cambiar', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('Gravedad alta');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Predio' }), 'p');
  await waitFor(() => {
    expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('predio=p'), expect.anything());
  });
  await user.click(screen.getByRole('button', { name: 'Fechas' }));
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2027-01-01' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('El período no es válido');
  expect(screen.getByRole('button', { name: 'Exportar a PDF' })).toBeDisabled();
  // Elegir un período descarta el borrador inválido y su aviso.
  await user.click(screen.getByRole('button', { name: '7 días' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('una fecha mal escrita en la URL no rompe la pantalla', async () => {
  window.history.pushState({}, '', '/incidentes-y-respuesta?desde=2026-10-01&hasta=nada');
  renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent('El período no es válido');
});
