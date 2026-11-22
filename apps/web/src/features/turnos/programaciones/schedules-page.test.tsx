import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import {
  SchedulePreviewTable,
  ScheduleResult,
  SchedulesPage,
  WeekdaySelector,
} from './schedules-page';
import { ShiftsPanel } from '../shifts-panel';

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
  weekdays: [1],
  startTime: '22:00',
  endTime: '06:00',
  startDate: '2030-10-05',
  endDate: '2030-10-30',
  status: 'active' as const,
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
  globalThis.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));
  jest.clearAllMocks();
  jest.mocked(apiGet).mockImplementation((path) => {
    if (path === '/programaciones-turnos') return Promise.resolve([schedule] as never);
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
  expect(screen.getByRole('status')).toHaveTextContent('1 días seleccionados');
  await user.keyboard(' ');
  expect(screen.getByRole('checkbox', { name: 'Lunes' })).not.toBeChecked();
});
it('muestra el conflicto con texto e identifica el turno; las ventanas no impiden confirmar', () => {
  render(<SchedulePreviewTable preview={preview} />);
  expect(screen.getByText('Conflicto: no se generará')).toBeInTheDocument();
  expect(screen.getByText(/Turno conflicting/)).toBeInTheDocument();
  expect(screen.getByText(/Podés confirmar igualmente/)).toBeInTheDocument();
});
it('informa los afectados y conservados', () => {
  render(<ScheduleResult result={result} />);
  expect(screen.getByRole('status')).toHaveTextContent(
    '1 turnos generados, 1 afectados y 1 conservados',
  );
  expect(screen.getByText('manual')).toBeInTheDocument();
  expect(screen.getByText('old')).toBeInTheDocument();
});
it('previsualiza una modificación, invalida la vista al cambiar datos y confirma', async () => {
  jest.mocked(apiPost).mockResolvedValue({
    ...preview,
    shifts: preview.shifts.map((shift) => ({ ...shift, conflicts: [] })),
  });
  renderWithQueryClient(<SchedulesPage />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Modificar' }));
  await user.click(screen.getByRole('button', { name: 'Previsualizar' }));
  await screen.findByRole('button', { name: 'Confirmar modificación' });
  expect(apiPost).toHaveBeenCalledWith(
    '/programaciones-turnos/previsualizar?programacion=schedule',
    expect.objectContaining({ siteId: 'site' }),
    expect.anything(),
    expect.anything(),
  );
  fireEvent.change(screen.getByLabelText('Hora de inicio (obligatorio)'), {
    target: { value: '21:00' },
  });
  expect(screen.queryByRole('button', { name: 'Confirmar modificación' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Previsualizar' }));
  await user.click(await screen.findByRole('button', { name: 'Confirmar modificación' }));
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
});
it.each(['Extender', 'Cancelar programación'])(
  'confirma la acción %s desde el listado',
  async (name) => {
    renderWithQueryClient(<SchedulesPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name }));
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
it('muestra ambos distintivos dentro de la pantalla de turnos', async () => {
  const fallback = jest.mocked(apiGet).getMockImplementation();
  if (!fallback) throw new Error('Falta el mock de las consultas');
  jest.mocked(apiGet).mockImplementation((path, schema) =>
    path.startsWith('/turnos')
      ? Promise.resolve(
          schema.parse([
            {
              id: 'shift',
              siteId: 'site',
              startsAt: '2030-10-06T01:00Z',
              endsAt: '2030-10-06T09:00Z',
              serviceDate: '2030-10-05',
              status: 'scheduled',
              scheduleId: 'schedule',
              individuallyModified: true,
              site,
              assignments: [],
              rounds: [],
            },
          ]),
        )
      : fallback(path, schema),
  );
  renderWithQueryClient(<ShiftsPanel />);
  expect(await screen.findByText('De programación')).toBeInTheDocument();
  expect(screen.getByText('Modificado individualmente')).toBeInTheDocument();
});
