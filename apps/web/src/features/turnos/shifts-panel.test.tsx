import { screen } from '@testing-library/react';
import { apiGet } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { ShiftsPanel } from './shifts-panel';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn(), apiPost: jest.fn() }));

describe('<ShiftsPanel />', () => {
  it('muestra turnos en hora local e indica una invitación pendiente', async () => {
    jest.mocked(apiGet).mockImplementation((path: string) => {
      if (path.startsWith('/turnos'))
        return Promise.resolve([
          {
            id: 'shift-1',
            startsAt: '2030-10-14T23:00:00.000Z',
            endsAt: '2030-10-15T11:00:00.000Z',
            serviceDate: '2030-10-14T00:00:00.000Z',
            status: 'scheduled',
            site: { name: 'Predio A', company: { timezone: 'America/Argentina/Buenos_Aires' } },
            assignments: [
              { guard: { firstName: 'Pedro', lastName: 'Díaz', status: 'invitation_pending' } },
            ],
            rounds: [{ round: { name: 'Perimetral' } }],
          },
        ] as never);
      if (path.startsWith('/predios')) return Promise.resolve([] as never);
      return Promise.resolve({ items: [] } as never);
    });
    renderWithQueryClient(<ShiftsPanel />);
    expect(await screen.findByText('Predio A · 14/10/2030')).toBeInTheDocument();
    expect(screen.getByText('20:00–08:00')).toBeInTheDocument();
    expect(screen.getByText('Pedro Díaz · invitación pendiente')).toBeInTheDocument();
    expect(screen.getByText('Rondas: Perimetral')).toBeInTheDocument();
  });
});
