import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient } from '@/test/render';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api-client';
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
  // Las llamadas de un test no cuentan en el siguiente, aunque un expect falle a mitad.
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('elige la ronda del mapa y la da de baja desde su menú con confirmación', async () => {
    const version = (ids: string[]) => ({
      frequencyMinutes: 120,
      windowStartLocal: '22:00',
      windowEndLocal: '06:00',
      graceMinutes: 15,
      route: null,
      checkpoints: ids.map((id, position) => ({ position, checkpoint: { id, name: id } })),
    });
    const rounds = [
      { id: 'r-old', name: 'Vieja', status: 'inactive', currentVersion: version(['p1']) },
      { id: 'r1', name: 'Perimetral', status: 'active', currentVersion: version(['p1', 'p2']) },
    ];
    jest
      .mocked(useAuth)
      .mockReturnValue({ user: { role: 'admin' }, loading: false } as ReturnType<typeof useAuth>);
    jest
      .mocked(apiGet)
      .mockImplementation((path: string) =>
        Promise.resolve((path.includes('puntos') ? points : rounds) as never),
      );
    renderWithQueryClient(<RoundsPanel site={site} />);
    const user = userEvent.setup();
    // Activas primero y elegida por defecto; la inactiva va al final con su sello.
    const list = await screen.findByRole('list', { name: 'Rondas del predio' });
    const first = within(list).getByRole('button', { name: /^Perimetral/ });
    const second = within(list).getByRole('button', { name: /^Vieja/ });
    expect(list.firstElementChild).toContainElement(first);
    expect(first).toHaveTextContent('Perimetral');
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(first).toHaveTextContent('2 puntos · Sin recorrido');
    expect(second).toHaveTextContent('Inactiva');
    expect(screen.getByRole('heading', { name: 'Recorrido · Perimetral' })).toBeInTheDocument();
    await user.click(second);
    expect(screen.getByRole('heading', { name: 'Recorrido · Vieja' })).toBeInTheDocument();
    // La inactiva solo se duplica; la activa además se edita y se da de baja.
    await user.click(screen.getByRole('button', { name: 'Acciones de Vieja' }));
    expect(await screen.findByRole('menuitem', { name: 'Duplicar' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Editar' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Acciones de Perimetral' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Dar de baja' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Dar de baja la ronda' });
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar baja' }));
    expect(apiPost).toHaveBeenCalledWith(
      '/rondas/r1/baja',
      {},
      expect.anything(),
      expect.anything(),
    );
  });

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
    fireEvent.change(screen.getByLabelText('Frecuencia (min)'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText(/Gracia/), { target: { value: '20' } });
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/como máximo, 15 minutos/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Gracia/), { target: { value: '10' } });
    await user.click(screen.getByRole('button', { name: 'Bajar Portón' }));
    const ordered = screen.getByRole('list', { name: 'Orden de puntos' });
    expect(ordered.firstElementChild).toHaveTextContent('Depósito');
  });

  it('sin puntos, guardar desde Tramos vuelve a Orden y muestra el error', async () => {
    await openNew();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nombre'), 'Perimetral');
    await user.click(screen.getByRole('button', { name: 'Tramos' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Sumá al menos un punto a la ronda.')).toBeVisible();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('muestra los errores de frecuencia y gracia junto a sus campos', async () => {
    await openNew();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Nombre'), 'Perimetral');
    await user.click(await screen.findByRole('button', { name: 'Sumar Portón' }));
    fireEvent.change(screen.getByLabelText('Frecuencia (min)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Gracia/), { target: { value: '10' } });
    const form = screen.getByRole('button', { name: 'Guardar' }).closest('form');
    if (!form) throw new Error('No se encontró el formulario de ronda.');
    form.noValidate = true;
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    const frequencyInput = screen.getByLabelText('Frecuencia (min)');
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
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
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
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
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
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
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
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
      await user.click(
        await screen.findByRole('button', { name: 'Guardar con esas partes rectas' }),
      );
      await waitFor(() => {
        expect(jest.mocked(apiPost).mock.calls.at(-1)?.[1]).toMatchObject({ allowStraight: true });
      });
      expect(await screen.findByText('Ronda creada.')).toBeInTheDocument();
    });
  });

  it('duplica una ronda como una nueva y ajusta el ancho de la lista con el teclado', async () => {
    const rounds = [
      {
        id: 'r1',
        name: 'Perimetral',
        status: 'active',
        currentVersion: {
          frequencyMinutes: 60,
          windowStartLocal: '20:00',
          windowEndLocal: '08:00',
          graceMinutes: 10,
          route: null,
          checkpoints: [
            { position: 0, checkpoint: { id: 'p1', name: 'Portón' } },
            { position: 1, checkpoint: { id: 'p2', name: 'Depósito' } },
          ],
        },
      },
    ];
    jest
      .mocked(useAuth)
      .mockReturnValue({ user: { role: 'admin' }, loading: false } as ReturnType<typeof useAuth>);
    jest
      .mocked(apiGet)
      .mockImplementation((path: string) =>
        Promise.resolve((path.includes('puntos') ? points : rounds) as never),
      );
    renderWithQueryClient(<RoundsPanel site={site} />);
    const user = userEvent.setup();
    const resizer = await screen.findByRole('separator', { name: 'Ancho de la lista de rondas' });
    const before = Number(resizer.getAttribute('aria-valuenow'));
    resizer.focus();
    await user.keyboard('{ArrowRight}');
    expect(Number(resizer.getAttribute('aria-valuenow'))).toBe(before + 2);
    await user.keyboard('{End}');
    expect(resizer).toHaveAttribute('aria-valuenow', '75');

    await user.click(screen.getByRole('button', { name: 'Acciones de Perimetral' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicar' }));
    expect(
      await screen.findByRole('heading', { name: 'Duplicar ronda', level: 3 }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Copia de Perimetral');
    expect(screen.getByLabelText('Velocidad')).toHaveValue('');
    await user.selectOptions(screen.getByLabelText('Velocidad'), 'vehicle');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/predios/site-1/rondas',
        expect.objectContaining({
          name: 'Copia de Perimetral',
          checkpointIds: ['p1', 'p2'],
          frequencyMinutes: 60,
          windowStartLocal: '20:00',
          windowEndLocal: '08:00',
          graceMinutes: 10,
          speedProfile: 'vehicle',
        }),
        expect.anything(),
        expect.anything(),
      );
    });
    expect(apiPatch).not.toHaveBeenCalled();
  });

  it('al editar avisa cuántos turnos programados alcanza el cambio; al duplicar, no', async () => {
    const rounds = [
      {
        id: 'r1',
        name: 'Perimetral',
        status: 'active',
        scheduledShifts: 3,
        currentVersion: {
          frequencyMinutes: 60,
          windowStartLocal: '20:00',
          windowEndLocal: '08:00',
          graceMinutes: 10,
          route: null,
          checkpoints: [{ position: 0, checkpoint: { id: 'p1', name: 'Portón' } }],
        },
      },
    ];
    jest
      .mocked(useAuth)
      .mockReturnValue({ user: { role: 'admin' }, loading: false } as ReturnType<typeof useAuth>);
    jest
      .mocked(apiGet)
      .mockImplementation((path: string) =>
        Promise.resolve((path.includes('puntos') ? points : rounds) as never),
      );
    renderWithQueryClient(<RoundsPanel site={site} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Acciones de Perimetral' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Editar' }));
    expect(await screen.findByRole('note', { name: 'Turnos afectados' })).toHaveTextContent(
      'Los cambios se aplican a los 3 turnos programados con esta ronda. Los turnos en curso y el historial no cambian.',
    );
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.click(await screen.findByRole('button', { name: 'Acciones de Perimetral' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicar' }));
    await screen.findByRole('heading', { name: 'Duplicar ronda', level: 3 });
    expect(screen.queryByRole('note', { name: 'Turnos afectados' })).not.toBeInTheDocument();
  });

  it('al duplicar omite los puntos dados de baja y avisa cuáles', async () => {
    const rounds = [
      {
        id: 'r-old',
        name: 'Vieja',
        status: 'inactive',
        currentVersion: {
          frequencyMinutes: 120,
          windowStartLocal: '22:00',
          windowEndLocal: '06:00',
          graceMinutes: 15,
          // Recorrido guardado con el punto que después se dio de baja.
          route: {
            v: 1,
            closed: false,
            legs: [
              {
                from: [-64.2, -31.4],
                to: [-64.3, -31.5],
                waypoints: [],
                sections: [
                  {
                    mode: 'streets',
                    via: [],
                    geometry: [
                      [-64.2, -31.4],
                      [-64.3, -31.5],
                    ],
                    fallback: false,
                  },
                ],
              },
              {
                from: [-64.3, -31.5],
                to: [-64.201, -31.401],
                waypoints: [],
                sections: [
                  {
                    mode: 'streets',
                    via: [],
                    geometry: [
                      [-64.3, -31.5],
                      [-64.201, -31.401],
                    ],
                    fallback: false,
                  },
                ],
              },
            ],
          },
          checkpoints: [
            { position: 0, checkpoint: { id: 'p1', name: 'Portón' } },
            { position: 1, checkpoint: { id: 'gone', name: 'Garita vieja' } },
            { position: 2, checkpoint: { id: 'p2', name: 'Depósito' } },
          ],
        },
      },
    ];
    jest
      .mocked(useAuth)
      .mockReturnValue({ user: { role: 'admin' }, loading: false } as ReturnType<typeof useAuth>);
    jest
      .mocked(apiGet)
      .mockImplementation((path: string) =>
        Promise.resolve((path.includes('puntos') ? points : rounds) as never),
      );
    renderWithQueryClient(<RoundsPanel site={site} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Acciones de Vieja' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicar' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'No se copiaron puntos dados de baja: Garita vieja.',
    );
    expect(screen.getByRole('list', { name: 'Orden de puntos' }).children).toHaveLength(2);
    // Ningún punto se movió: lo guardado no se compara contra la lista sin el omitido.
    expect(screen.queryByText(/se movió un punto/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/predios/site-1/rondas',
        expect.objectContaining({ checkpointIds: ['p1', 'p2'] }),
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
