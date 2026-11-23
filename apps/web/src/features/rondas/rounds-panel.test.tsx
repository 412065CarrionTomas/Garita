import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient } from '@/test/render';
import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';
import { RoundsPanel } from './rounds-panel';

jest.mock('../auth/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/api-client', () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>('@/lib/api-client').ApiError,
  apiGet: jest.fn(),
  apiPost: jest.fn(() => Promise.resolve({ id: 'round-1' })),
  apiPatch: jest.fn(() => Promise.resolve({ id: 'round-1' })),
}));

const site = { id: 'site-1', status: 'active' as const };
const points = [
  { id: 'p1', name: 'Portón', latitude: -31.4, longitude: -64.2 },
  { id: 'p2', name: 'Depósito', latitude: -31.401, longitude: -64.201 },
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
  it.each(['light', 'dark'])('conserva el formulario y los tokens en tema %s', async (theme) => {
    setup().unmount();
    const { container } = renderWithQueryClient(
      <div className={theme}>
        <RoundsPanel site={site} />
      </div>,
    );
    expect(await screen.findByRole('heading', { name: 'Rondas', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Puntos en orden de recorrido' })).toBeInTheDocument();
    expect(container.querySelector('[data-slot=card]')).toHaveClass(
      'bg-card',
      'text-card-foreground',
    );
    expect(container.innerHTML).not.toMatch(
      /(?:bg|text|border)-(?:white|black|red|amber|gray|slate|zinc|blue|green)(?:-|\b)|#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i,
    );
  });

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

  it('muestra los errores de frecuencia y gracia junto a sus campos', async () => {
    setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nombre'), 'Perimetral');
    await user.click(await screen.findByLabelText('Portón'));
    fireEvent.change(screen.getByLabelText('Frecuencia (minutos)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Gracia/), { target: { value: '10' } });
    const form = screen.getByRole('button', { name: 'Guardar ronda' }).closest('form');
    if (!form) throw new Error('No se encontró el formulario de ronda.');
    form.noValidate = true;
    await user.click(screen.getByRole('button', { name: 'Guardar ronda' }));

    const frequencyInput = screen.getByLabelText('Frecuencia (minutos)');
    const graceInput = screen.getByLabelText(/Gracia/);
    await waitFor(() => {
      expect(frequencyInput).toHaveAttribute('aria-invalid', 'true');
    });
    expect(frequencyInput).toHaveAttribute('aria-describedby', 'round-frequency-error');
    expect(graceInput).toHaveAttribute('aria-invalid', 'true');
    expect(graceInput).toHaveAttribute('aria-describedby', 'round-grace-error');
    expect(
      screen.getAllByText('La frecuencia debe estar entre 15 minutos y 24 horas.'),
    ).toHaveLength(2);
    expect(screen.getAllByText(/La gracia puede ser, como máximo, 5 minutos/)).toHaveLength(2);
  });

  describe('recorrido', () => {
    async function fillRound() {
      const view = setup();
      const user = userEvent.setup();
      await user.type(screen.getByLabelText('Nombre'), 'Perimetral');
      await user.click(await screen.findByLabelText('Portón'));
      await user.click(screen.getByLabelText('Depósito'));
      expect(await screen.findByRole('heading', { name: 'Recorrido' })).toBeInTheDocument();
      return { view, user };
    }
    const sentRoute = () => {
      const call = jest.mocked(apiPost).mock.calls.find(([path]) => path.endsWith('/rondas'));
      return call?.[1] as { route: unknown; allowStraight?: boolean } | undefined;
    };

    beforeEach(() => {
      jest.mocked(apiPost).mockClear();
      jest.mocked(apiPost).mockResolvedValue({ id: 'round-1' });
    });

    it('arma un circuito por calles y lo manda al guardar', async () => {
      const { user } = await fillRound();
      expect(screen.getByRole('checkbox', { name: 'Volver al inicio' })).toBeChecked();
      expect(screen.getByRole('heading', { name: 'Tramo 2 → 1 (regreso)' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Guardar ronda' }));
      await waitFor(() => {
        expect(sentRoute()?.route).toEqual({
          closed: true,
          legs: [
            { waypoints: [], sections: [{ mode: 'streets', via: [] }] },
            { waypoints: [], sections: [{ mode: 'streets', via: [] }] },
          ],
        });
      });
    });

    it('cambia el modo, agrega un punto de paso desde la lista y quita el regreso', async () => {
      const { user } = await fillRound();
      await user.click(screen.getByRole('checkbox', { name: 'Volver al inicio' }));
      expect(screen.queryByRole('heading', { name: /regreso/ })).not.toBeInTheDocument();
      await user.click(
        screen.getByRole('button', { name: 'Agregar punto de paso al tramo 1 → 2' }),
      );
      expect(screen.getByText('Punto de paso 1')).toBeInTheDocument();
      const second = screen.getByRole('group', { name: 'Modo del tramo 1 → 2 (parte 2)' });
      await user.click(within(second).getByRole('button', { name: 'A mano' }));
      expect(within(second).getByRole('button', { name: 'A mano' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await user.click(screen.getByRole('button', { name: 'Guardar ronda' }));
      await waitFor(() => {
        expect(sentRoute()?.route).toEqual({
          closed: false,
          legs: [
            {
              waypoints: [[expect.closeTo(-64.2005), expect.closeTo(-31.4005)]],
              sections: [
                { mode: 'streets', via: [] },
                { mode: 'manual', via: [] },
              ],
            },
          ],
        });
      });
    });

    it('si el ruteo falla avisa los tramos, conserva el trabajo y permite guardar recto', async () => {
      const { user } = await fillRound();
      await user.click(
        screen.getByRole('button', { name: 'Agregar punto de paso al tramo 1 → 2' }),
      );
      jest.mocked(apiPost).mockRejectedValueOnce(
        new ApiError('422', 422, {
          message: 'No se pudo calcular',
          failures: [{ leg: 0, section: 1, reason: 'unreachable_point' }],
        }),
      );
      await user.click(screen.getByRole('button', { name: 'Guardar ronda' }));
      const dialog = await screen.findByRole('alertdialog', {
        name: 'No se pudo calcular el recorrido',
      });
      expect(dialog).toHaveTextContent(
        'No se encontró una calle cerca de un punto de el tramo 1 → 2',
      );
      await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.getByText('Punto de paso 1')).toBeInTheDocument();
      expect(screen.getByLabelText('Nombre')).toHaveValue('Perimetral');

      jest.mocked(apiPost).mockRejectedValueOnce(
        new ApiError('422', 422, {
          message: 'No se pudo calcular',
          failures: [{ leg: 0, section: 1, reason: 'unreachable_point' }],
        }),
      );
      await user.click(screen.getByRole('button', { name: 'Guardar ronda' }));
      await user.click(await screen.findByRole('button', { name: 'Guardar con tramos rectos' }));
      await waitFor(() => {
        expect(jest.mocked(apiPost).mock.calls.at(-1)?.[1]).toMatchObject({ allowStraight: true });
      });
      expect(await screen.findByText('Ronda creada.')).toBeInTheDocument();
    });
  });
});
