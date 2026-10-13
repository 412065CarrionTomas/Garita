import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient } from '@/test/render';
import { apiGet } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';
import { RoundsPanel } from './rounds-panel';

jest.mock('../auth/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/api-client', () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(() => Promise.resolve({ id: 'round-1' })),
  apiPatch: jest.fn(() => Promise.resolve({ id: 'round-1' })),
}));

const site = { id: 'site-1', status: 'active' as const };
const points = [
  { id: 'p1', name: 'Portón' },
  { id: 'p2', name: 'Depósito' },
];
function setup() {
  jest
    .mocked(useAuth)
    .mockReturnValue({ user: { role: 'admin' }, loading: false } as ReturnType<typeof useAuth>);
  jest
    .mocked(apiGet)
    .mockImplementation((path: string) =>
      Promise.resolve((path.includes('puntos') ? points : []) as never),
    );
  return renderWithQueryClient(<RoundsPanel site={site} />);
}

describe('RoundsPanel', () => {
  it('muestra las ventanas nocturnas y recorta la última', async () => {
    setup();
    expect(await screen.findByText('22:00–00:00')).toBeInTheDocument();
    expect(screen.getByText('00:00–02:00')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Inicio de franja'), { target: { value: '20:00' } });
    fireEvent.change(screen.getByLabelText('Fin de franja'), { target: { value: '01:00' } });
    expect(screen.getByText('00:00–01:00')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Inicio de franja'), { target: { value: '06:00' } });
    fireEvent.change(screen.getByLabelText('Fin de franja'), { target: { value: '06:00' } });
    expect(screen.getByText('Todo el día (24 h)')).toBeInTheDocument();
    expect(
      screen.getAllByRole('list', { name: 'Vista previa de ventanas' })[0]?.querySelectorAll('li'),
    ).toHaveLength(12);
  });

  it('rechaza una gracia mayor que la mitad de la frecuencia y ordena con botones', async () => {
    setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nombre'), 'Perimetral');
    await user.click(await screen.findByLabelText('Portón'));
    await user.click(screen.getByLabelText('Depósito'));
    fireEvent.change(screen.getByLabelText('Frecuencia (minutos)'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText(/Gracia/), { target: { value: '20' } });
    await user.click(screen.getByRole('button', { name: 'Guardar ronda' }));
    expect(await screen.findByText(/como máximo, 15 minutos/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Gracia/), { target: { value: '10' } });
    await user.click(screen.getByRole('button', { name: 'Bajar Portón' }));
    const ordered = screen.getByRole('list', { name: 'Orden de puntos' });
    expect(ordered.firstElementChild).toHaveTextContent('Depósito');
  });
});
