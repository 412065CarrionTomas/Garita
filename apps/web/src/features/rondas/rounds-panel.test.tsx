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
/** Abre el editor de una ronda nueva. */
async function openNew() {
  const view = setup();
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Nueva ronda' }));
  await screen.findByLabelText('Nombre');
  return view;
}

describe('RoundsPanel', () => {
  it.each(['light', 'dark'])('conserva el editor y los tokens en tema %s', async (theme) => {
    setup().unmount();
    const { container } = renderWithQueryClient(
      <div className={theme}>
        <RoundsPanel site={site} />
      </div>,
    );
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Nueva ronda' }));
    expect(
      await screen.findByRole('heading', { name: 'Nueva ronda', level: 3 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Puntos fuera de la ronda' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Herramienta del mapa' })).toBeInTheDocument();
    expect(container.querySelector('section')).toHaveClass('bg-card');
    expect(container.innerHTML).not.toMatch(
      /(?:bg|text|border)-(?:white|black|red|amber|gray|slate|zinc|blue|green)(?:-|\b)|#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i,
    );
  });

  it('vuelve a la lista sin guardar y deshace el último cambio de puntos', async () => {
    await openNew();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sumar Portón' }));
    await user.click(screen.getByRole('button', { name: 'Sumar Depósito' }));
    expect(screen.getByRole('list', { name: 'Orden de puntos' }).children).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(screen.getByRole('list', { name: 'Orden de puntos' }).children).toHaveLength(1);
    // Con cambios, salir pide confirmación: si se rechaza, el editor sigue abierto.
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(confirm).toHaveBeenCalledWith('¿Descartar los cambios de la ronda?');
    expect(screen.getByLabelText('Nombre')).toBeInTheDocument();
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('button', { name: 'Nueva ronda' })).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalledWith(
      expect.stringContaining('/rondas'),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('muestra las ventanas nocturnas y recorta la última', async () => {
    await openNew();
    expect(await screen.findByText('22:00–00:00')).toBeInTheDocument();
    expect(screen.getByText('00:00–02:00')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Inicio de franja'), { target: { value: '20:00' } });
    fireEvent.change(screen.getByLabelText('Fin de franja'), { target: { value: '01:00' } });
    expect(screen.getByText('00:00–01:00')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Inicio de franja'), { target: { value: '06:00' } });
    fireEvent.change(screen.getByLabelText('Fin de franja'), { target: { value: '06:00' } });
    expect(screen.getByText(/Todo el día \(24 h\)/)).toBeInTheDocument();
    expect(
      screen.getAllByRole('list', { name: 'Vista previa de ventanas' })[0]?.querySelectorAll('li'),
    ).toHaveLength(12);
  });

  it('rechaza una gracia mayor que la mitad de la frecuencia y ordena con botones', async () => {
    await openNew();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nombre'), 'Perimetral');
    await user.click(await screen.findByRole('button', { name: 'Sumar Portón' }));
    await user.click(screen.getByRole('button', { name: 'Sumar Depósito' }));
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
    await openNew();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nombre'), 'Perimetral');
    await user.click(await screen.findByRole('button', { name: 'Sumar Portón' }));
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

  it('pide confirmar al salir si solo cambió el horario', async () => {
    await openNew();
    const user = userEvent.setup();
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.change(screen.getByLabelText('Gracia (minutos)'), { target: { value: '10' } });
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(confirm).toHaveBeenCalledWith('¿Descartar los cambios de la ronda?');
    expect(screen.getByLabelText('Nombre')).toBeInTheDocument();
  });

  it('Ctrl+Mayús+Z no deshace y las teclas no tocan el editor con la ayuda abierta', async () => {
    await openNew();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sumar Portón' }));
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(screen.getByRole('list', { name: 'Orden de puntos' }).children).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Ayuda del editor de rondas' }));
    await user.keyboard('e');
    await user.keyboard('{Escape}');
    const tools = screen.getByRole('group', { name: 'Herramienta del mapa' });
    expect(within(tools).getByRole('button', { name: 'Seleccionar' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  describe('recorrido', () => {
    async function fillRound() {
      const view = await openNew();
      const user = userEvent.setup();
      await user.type(screen.getByLabelText('Nombre'), 'Perimetral');
      await user.click(screen.getByRole('button', { name: 'Sumar Portón' }));
      await user.click(screen.getByRole('button', { name: 'Sumar Depósito' }));
      return { view, user };
    }
    /** Le suma al tramo 1 → 2 un punto de guía desde la lista y lo vuelve cambio de modo. */
    async function splitFirstLeg(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('button', { name: 'Tramos' }));
      await user.click(screen.getByRole('button', { name: 'Sumar punto de guía a Tramo 1 → 2' }));
      expect(screen.getByText(/Punto de guía 1 · Tramo 1 → 2/)).toBeInTheDocument();
      await user.click(screen.getByRole('switch', { name: /Cambiar de modo en este punto/ }));
      expect(
        screen.getByText('De Por calles a Trazo libre. No se escanea ni se controla.'),
      ).toBeInTheDocument();
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
      expect(screen.getByRole('switch', { name: 'Volver al inicio' })).toBeChecked();
      await user.click(screen.getByRole('button', { name: 'Tramos' }));
      expect(screen.getByText('Tramo 2 → 1 (vuelta)')).toBeInTheDocument();
      expect(screen.getByText('2 partes sin calcular · hasta 1 pedido')).toBeInTheDocument();
      // Plegar un tramo esconde sus partes.
      const leg = screen.getByRole('button', { name: /^Tramo 1 → 2/ });
      await user.click(leg);
      expect(leg).toHaveAttribute('aria-expanded', 'false');
      expect(
        screen.queryByRole('button', { name: 'Sumar punto de guía a Tramo 1 → 2' }),
      ).not.toBeInTheDocument();
      await user.click(leg);
      expect(
        screen.getByRole('button', { name: 'Sumar punto de guía a Tramo 1 → 2' }),
      ).toBeInTheDocument();
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

    it('despliega los puntos de guía de una parte, elige uno y lo borra', async () => {
      const { user } = await fillRound();
      await user.click(screen.getByRole('switch', { name: 'Volver al inicio' }));
      await user.click(screen.getByRole('button', { name: 'Tramos' }));
      const add = screen.getByRole('button', { name: 'Sumar punto de guía a Tramo 1 → 2' });
      await user.click(add);
      await user.click(add);
      await user.click(screen.getByRole('button', { name: 'Ver puntos de guía de Tramo 1 → 2' }));
      const guides = screen.getByRole('list', { name: 'Puntos de guía de Tramo 1 → 2' });
      expect(within(guides).getAllByRole('listitem')).toHaveLength(2);
      await user.click(within(guides).getByRole('button', { name: /^2 ?Punto de guía$/ }));
      expect(screen.getByText(/Punto de guía 2 · Tramo 1 → 2/)).toBeInTheDocument();
      await user.click(
        screen.getByRole('button', { name: 'Eliminar punto de guía 2 de Tramo 1 → 2' }),
      );
      expect(within(guides).getAllByRole('listitem')).toHaveLength(1);
    });

    it('suma trazo libre hasta el destino desde la lista y quita la vuelta', async () => {
      const { user } = await fillRound();
      await user.click(screen.getByRole('switch', { name: 'Volver al inicio' }));
      await user.click(screen.getByRole('button', { name: 'Tramos' }));
      expect(screen.queryByText(/vuelta/)).not.toBeInTheDocument();
      await user.click(
        screen.getByRole('button', { name: 'Sumar Trazo libre al final de Tramo 1 → 2' }),
      );
      // Solo la última parte ofrece el otro modo.
      expect(
        screen.queryByRole('button', { name: /Sumar .* al final de Tramo 1 → 2, parte 1/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Sumar Por calles al final de Tramo 1 → 2, parte 2' }),
      ).toBeInTheDocument();
      const mode = screen.getByRole('group', { name: 'Modo de Tramo 1 → 2, parte 2' });
      expect(within(mode).getByRole('button', { name: 'Trazo libre' })).toHaveAttribute(
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

    it('si el ruteo falla avisa la parte, la muestra y permite guardarla recta', async () => {
      const { user } = await fillRound();
      await user.click(screen.getByRole('switch', { name: 'Volver al inicio' }));
      await splitFirstLeg(user);
      const failure = () =>
        new ApiError('422', 422, {
          message: 'No se pudo calcular',
          failures: [{ leg: 0, section: 0, reason: 'unreachable_point' }],
        });
      jest.mocked(apiPost).mockRejectedValueOnce(failure());
      await user.click(screen.getByRole('button', { name: 'Guardar ronda' }));
      const dialog = await screen.findByRole('alertdialog', {
        name: 'No se pudo calcular el recorrido',
      });
      expect(dialog).toHaveTextContent('Tramo 1 → 2, parte 1: Un punto no está cerca');
      await user.click(within(dialog).getByRole('button', { name: 'Ver la parte con falla' }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Modo de Tramo 1 → 2, parte 1' })).toBeVisible();
      expect(screen.getAllByText(/Falló/).length).toBeGreaterThan(0);
      expect(screen.getByLabelText('Nombre')).toHaveValue('Perimetral');

      jest.mocked(apiPost).mockRejectedValueOnce(failure());
      await user.click(screen.getByRole('button', { name: 'Guardar ronda' }));
      await user.click(
        await screen.findByRole('button', { name: 'Guardar con esas partes rectas' }),
      );
      await waitFor(() => {
        expect(jest.mocked(apiPost).mock.calls.at(-1)?.[1]).toMatchObject({ allowStraight: true });
      });
      expect(await screen.findByText('Ronda creada.')).toBeInTheDocument();
    });
  });
});
