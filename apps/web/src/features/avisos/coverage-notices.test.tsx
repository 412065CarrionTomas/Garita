import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { z } from 'zod';
import type { noticeSchema } from '@garita/shared';
import { apiGet, apiPut, apiPost } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { NoticeActions } from './notice-actions';
import { NoticeRow } from './notice-row';
import { NotificationPreferencesPage } from './notification-preferences-page';

jest.mock('@/lib/api-client', () => ({
  apiGet: jest.fn(),
  apiPut: jest.fn(),
  apiPost: jest.fn(),
  ApiError: class extends Error {},
}));
const notice: z.infer<typeof noticeSchema> = {
  id: 'notice',
  companyId: 'company',
  siteId: 'site',
  shiftId: 'shift',
  kind: 'shift_not_started',
  subjectId: 'assignment',
  key: 'shift_not_started:assignment',
  status: 'open',
  resolution: null,
  resolvedAt: null,
  seenAt: '2030-01-01T22:00:00Z',
  createdAt: '2030-01-01T22:15:00Z',
  details: null,
  site: { name: 'Depósito', minutesToSignal: 200 },
  shift: { startsAt: '2030-01-01T22:00:00Z', endsAt: '2035-01-02T06:00:00Z' },
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(apiGet).mockResolvedValue([] as never);
});
it.each([
  ['shift_not_started', 'Reasignar turno'],
  ['shift_closed_early', 'Cubrir el resto'],
  ['shift_without_guard', 'Asignar vigilador'],
] as const)(
  '%s abre el diálogo reutilizable y oculta la acción al resolver',
  async (kind, label) => {
    const user = userEvent.setup();
    const { unmount } = renderWithQueryClient(<NoticeActions notice={{ ...notice, kind }} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent(label);
    await user.click(screen.getByRole('button', { name: label }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      kind === 'shift_closed_early' ? 'Cubrir el resto' : 'Reasignar turno',
    );
    unmount();
    renderWithQueryClient(<NoticeActions notice={{ ...notice, kind, status: 'resolved' }} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  },
);
it('el interruptor tiene etiqueta, aria-checked y confirmación anunciada al guardar', async () => {
  jest.mocked(apiGet).mockResolvedValue({ shift_not_started: true });
  jest.mocked(apiPut).mockResolvedValue({ shift_not_started: false });
  renderWithQueryClient(
    <MemoryRouter>
      <NotificationPreferencesPage />
    </MemoryRouter>,
  );
  const toggle = await screen.findByRole('switch', { name: 'Notificarme los turnos no iniciados' });
  expect(toggle).toHaveAttribute('aria-checked', 'true');
  await userEvent.setup().click(toggle);
  expect(await screen.findByRole('status')).toHaveTextContent('Preferencia guardada.');
  expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(apiPut).toHaveBeenCalledWith(
    '/mis-preferencias/notificaciones',
    { shift_not_started: false },
    expect.anything(),
    expect.anything(),
  );
});
it('muestra motivo, actor y las dos horas reales del cierre recibido tarde', () => {
  const closedAt = '2030-01-01T17:00:00Z',
    receivedAt = '2030-01-01T20:20:00Z';
  jest.mocked(apiPost).mockResolvedValue(notice);
  renderWithQueryClient(
    <MemoryRouter>
      <NoticeRow
        initiallyOpen
        notice={{
          ...notice,
          kind: 'shift_closed_early',
          details: {
            reason: 'Me descompuse',
            closedByName: 'Pedro Díaz',
            late: true,
            closedAt,
            receivedAt,
          },
        }}
      />
    </MemoryRouter>,
  );
  const time = (value: string) =>
    new Date(value).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  expect(
    screen.getByText(`Cerrado a las ${time(closedAt)}, recibido a las ${time(receivedAt)}`),
  ).toBeInTheDocument();
  expect(screen.getByText('Cerrado por: Pedro Díaz')).toBeInTheDocument();
  expect(screen.getByText('Motivo: Me descompuse')).toBeInTheDocument();
});
it('conserva el estado del interruptor si guardar falla', async () => {
  jest.mocked(apiGet).mockResolvedValue({ shift_not_started: true });
  jest.mocked(apiPut).mockRejectedValue(new Error('offline'));
  renderWithQueryClient(
    <MemoryRouter>
      <NotificationPreferencesPage />
    </MemoryRouter>,
  );
  const toggle = await screen.findByRole('switch');
  await userEvent.setup().click(toggle);
  expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos guardar');
  expect(toggle).toHaveAttribute('aria-checked', 'true');
});
