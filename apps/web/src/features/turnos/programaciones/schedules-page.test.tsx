import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { SchedulePreviewTable, WeekdaySelector } from './schedule-form-dialog';
import { ScheduleResult, SchedulesPage } from './schedules-page';

jest.mock('@/lib/api-client', () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(),
  apiPatch: jest.fn(),
  ApiError: class extends Error {},
}));
const schedule = {
  id: 'schedule',
  siteId: 'site',
  guardId: 'guard',
  roundIds: ['round'],
  weekdays: [1, 3, 5],
  startTime: '22:00',
  endTime: '06:00',
  startDate: '2030-10-05',
  endDate: '2030-10-30',
  status: 'active' as const,
  siteName: 'Depósito',
  guardName: 'Pedro Díaz',
  roundNames: ['Perimetral'],
  daysToEnd: 6,
  upcomingCount: 9,
  modifiedCount: 2,
};
const preview = {
  timezone: 'America/Argentina/Buenos_Aires',
  invitationPending: false,
  shifts: [
    {
      serviceDate: '2030-10-05',
      startsAt: '2030-10-06T01:00:00Z',
      endsAt: '2030-10-06T09:00:00Z',
      conflicts: [
        {
          shiftId: 'conflicting',
          startsAt: '2030-10-05T23:00:00Z',
          endsAt: '2030-10-06T11:00:00Z',
        },
      ],
    },
  ],
  uncoveredWindows: [
    {
      roundId: 'round',
      startUtc: '2030-10-06T07:00:00Z',
      endUtc: '2030-10-06T10:00:00Z',
      label: '04:00–07:00',
    },
  ],
};
const result = {
  schedule,
  generated: ['new'],
  replaced: ['old'],
  conserved: ['manual'],
  conflicts: [],
};
const site = {
  id: 'site',
  name: 'Depósito',
  company: { timezone: preview.timezone },
  status: 'active',
};
beforeEach(() => {
  window.history.replaceState({}, '', '/programaciones-turnos');
  globalThis.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));
  jest.clearAllMocks();
  jest.mocked(apiGet).mockImplementation((path) => {
    if (path.startsWith('/programaciones-turnos'))
      return Promise.resolve({ items: [schedule], expiring: 1 } as never);
    if (path.startsWith('/predios?')) return Promise.resolve([site] as never);
    if (path.includes('/rondas'))
      return Promise.resolve([{ id: 'round', name: 'Perimetral', status: 'active' }] as never);
    if (path.startsWith('/usuarios'))
      return Promise.resolve({
        items: [{ id: 'guard', firstName: 'Pedro', lastName: 'Díaz', status: 'active' }],
        paginas: 1,
      } as never);
    return Promise.resolve([] as never);
  });
  jest.mocked(apiPost).mockResolvedValue(result);
  jest.mocked(apiPatch).mockResolvedValue(result);
});

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', { name: 'Acciones de la programación de Depósito' }),
  );
}

it('el selector anuncia días y selección, con Tab y Espacio', async () => {
  function Harness() {
    const [value, setValue] = useState<number[]>([]);
    return <WeekdaySelector value={value} onChange={setValue} />;
  }
  render(<Harness />);
  const user = userEvent.setup();
  await user.tab();
  expect(screen.getByRole('checkbox', { name: 'Lunes' })).toHaveFocus();
  await user.keyboard(' ');
  expect(screen.getByRole('checkbox', { name: 'Lunes' })).toBeChecked();
  expect(screen.getByRole('status')).toHaveTextContent('1 elegido');
  await user.keyboard(' ');
  expect(screen.getByRole('checkbox', { name: 'Lunes' })).not.toBeChecked();
});

it('resume la vista previa: conflictos primero y ventanas con el nombre de la ronda', () => {
  render(
    <SchedulePreviewTable preview={preview} roundNames={new Map([['round', 'Perimetral']])} />,
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    '0 turnos a generar · 1 con conflicto · 1 ventanas sin cubrir',
  );
  expect(screen.getByText(/Conflicto: no se generará 1 turno/)).toBeInTheDocument();
  expect(screen.getByText(/el vigilador ya tiene un turno de/)).toBeInTheDocument();
  expect(screen.getByText(/Podés confirmar igualmente/)).toBeInTheDocument();
  expect(screen.getByText(/04:00–07:00 · Perimetral/)).toBeInTheDocument();
});

it('informa los generados, afectados y conservados', () => {
  render(<ScheduleResult result={result} />);
  expect(screen.getByRole('status')).toHaveTextContent(
    '1 turnos generados, 1 afectados y 1 conservados',
  );
});

it('muestra la semana tipo, la vigencia y los turnos de cada programación', async () => {
  renderWithQueryClient(<SchedulesPage />);
  const table = await screen.findByRole('table', { name: 'Programaciones' });
  expect(within(table).getByText('Pedro Díaz')).toBeInTheDocument();
  expect(within(table).getByRole('img', { name: 'Lunes, Miércoles, Viernes' })).toBeVisible();
  expect(within(table).getByText('Vence en 6 días')).toBeInTheDocument();
  expect(within(table).getByText('9 próximos')).toBeInTheDocument();
  expect(within(table).getByText('2 editados a mano')).toBeInTheDocument();
  expect(within(table).getByTitle('Termina al día siguiente')).toBeInTheDocument();
});

it('filtra por vencer desde el resumen y guarda el filtro en la URL', async () => {
  renderWithQueryClient(<SchedulesPage />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '1 por vencer en 14 días' }));
  expect(window.location.search).toContain('estado=por_vencer');
  await waitFor(() => {
    expect(apiGet).toHaveBeenCalledWith(
      '/programaciones-turnos?estado=por_vencer',
      expect.anything(),
    );
  });
});

it('abre el modal, calcula la vista previa sola, la invalida al cambiar datos y confirma', async () => {
  jest.mocked(apiPost).mockResolvedValue({
    ...preview,
    shifts: preview.shifts.map((shift) => ({ ...shift, conflicts: [] })),
  });
  renderWithQueryClient(<SchedulesPage />);
  const user = userEvent.setup();
  await openMenu(user);
  await user.click(screen.getByRole('menuitem', { name: 'Modificar' }));
  const panel = await screen.findByRole('dialog', { name: 'Modificar programación' });
  expect(within(panel).getByText(/Termina al día siguiente/)).toBeInTheDocument();
  expect(within(panel).queryByRole('button', { name: 'Previsualizar' })).not.toBeInTheDocument();
  const confirm = within(panel).getByRole('button', { name: 'Confirmar modificación' });
  await waitFor(() => {
    expect(confirm).toBeEnabled();
  });
  expect(apiPost).toHaveBeenCalledWith(
    '/programaciones-turnos/previsualizar?programacion=schedule',
    expect.objectContaining({ siteId: 'site' }),
    expect.anything(),
    expect.anything(),
  );
  fireEvent.change(within(panel).getByLabelText('Hora de inicio'), {
    target: { value: '21:00' },
  });
  expect(confirm).toBeDisabled();
  await waitFor(() => {
    expect(apiPost).toHaveBeenLastCalledWith(
      '/programaciones-turnos/previsualizar?programacion=schedule',
      expect.objectContaining({ startTime: '21:00' }),
      expect.anything(),
      expect.anything(),
    );
  });
  await waitFor(() => {
    expect(confirm).toBeEnabled();
  });
  jest.mocked(apiPatch).mockResolvedValue(result);
  await user.click(confirm);
  await waitFor(() => {
    expect(apiPatch).toHaveBeenCalledWith(
      '/programaciones-turnos/schedule',
      expect.objectContaining({ startTime: '21:00' }),
      expect.anything(),
      expect.anything(),
    );
  });
  expect(
    await screen.findByText(/1 turnos generados, 1 afectados y 1 conservados/),
  ).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it.each(['Extender', 'Cancelar programación'])(
  'confirma la acción %s desde el menú de la fila',
  async (name) => {
    renderWithQueryClient(<SchedulesPage />);
    const user = userEvent.setup();
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name }));
    if (name === 'Extender')
      fireEvent.change(screen.getByLabelText('Nueva fecha final incluida'), {
        target: { value: '2030-11-06' },
      });
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        `/programaciones-turnos/schedule/${name === 'Extender' ? 'extender' : 'cancelar'}`,
        name === 'Extender' ? { endDate: '2030-11-06' } : {},
        expect.anything(),
        expect.anything(),
      );
    });
  },
);

it('extender empieza el día siguiente al fin actual', async () => {
  renderWithQueryClient(<SchedulesPage />);
  const user = userEvent.setup();
  await openMenu(user);
  await user.click(screen.getByRole('menuitem', { name: 'Extender' }));
  expect(screen.getByLabelText('Nueva fecha final incluida')).toHaveAttribute('min', '2030-10-31');
  expect(screen.getByText(/Se agregan turnos desde el 31 oct/)).toBeInTheDocument();
});
