import type { ReactNode } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient } from '@/test/render';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';
import { CheckpointsPanel } from './checkpoints-panel';

jest.mock('../auth/auth-context', () => ({ useAuth: jest.fn() }));
// Mapa caído: el formulario muestra la carga manual de coordenadas.
jest.mock('@/features/mapa/site-location-map', () => ({
  SiteMapLocation: ({ unavailable }: { unavailable: ReactNode }) => unavailable,
  // Muestra los N° del mapa: en el modo edición se pueden tocar igual que los de la tabla.
  ClientSitesMap: ({ sites }: { sites: { id: string; label?: ReactNode }[] }) =>
    sites.map((point) => <span key={point.id}>{point.label}</span>),
}));
jest.mock('@/lib/api-client', () => ({
  apiGet: jest.fn(() => Promise.resolve([])),
  apiPost: jest.fn(() => Promise.resolve({ id: 'point-1' })),
  apiPatch: jest.fn(() => Promise.resolve({ id: 'point-1' })),
  apiDownload: jest.fn(() => Promise.resolve(new Blob())),
  ApiError: class ApiError extends Error {
    readonly status: number | undefined;
    readonly body: unknown;
    constructor(message: string, status?: number, body?: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
}));

const site = {
  id: 'site-1',
  name: 'Predio A',
  latitude: -34.6,
  longitude: -58.4,
  status: 'active' as const,
};

function setRole(role: 'admin' | 'supervisor') {
  jest.mocked(useAuth).mockReturnValue({
    user: { role },
    loading: false,
  } as ReturnType<typeof useAuth>);
}

describe('CheckpointsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.confirm = jest.fn(() => true);
  });

  it.each(['light', 'dark'])(
    'conserva el alta colapsable y los tokens en tema %s',
    async (theme) => {
      setRole('admin');
      const user = userEvent.setup();
      const { container } = renderWithQueryClient(
        <div className={theme}>
          <CheckpointsPanel site={site} />
        </div>,
      );
      expect(screen.queryByLabelText('Nombre del punto')).not.toBeInTheDocument();
      await user.click(await screen.findByRole('button', { name: 'Agregar punto' }));
      expect(screen.getByLabelText('Nombre del punto')).toBeInTheDocument();
      // El panel va sobre la hoja de la pestaña: sin fondo propio, con el texto del token.
      expect(container.querySelector('[data-slot=card]')).toHaveClass(
        'bg-transparent',
        'text-card-foreground',
      );
      expect(container.innerHTML).not.toMatch(
        /(?:bg|text|border)-(?:white|black|red|amber|gray|slate|zinc|blue|green)(?:-|\b)|#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i,
      );
    },
  );

  it('valida el radio de tolerancia fuera del rango permitido', async () => {
    setRole('admin');
    const user = userEvent.setup();
    renderWithQueryClient(<CheckpointsPanel site={site} />);
    await user.click(await screen.findByRole('button', { name: 'Agregar punto' }));
    await user.type(await screen.findByLabelText('Nombre del punto'), 'Portón');
    fireEvent.change(screen.getByLabelText('Radio de tolerancia (m)'), { target: { value: '5' } });
    const form = screen.getByRole('button', { name: 'Crear punto' }).closest('form');
    if (!form) throw new Error('No se encontró el formulario del punto');
    fireEvent.submit(form);
    expect(await screen.findByText(/entre 10 y 200 m/)).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('solicita confirmación accesible al recibir el código de ubicación lejana', async () => {
    setRole('admin');
    const post = jest.mocked(apiPost);
    post.mockRejectedValueOnce(
      new ApiError('conflicto', 409, { code: 'CHECKPOINT_LOCATION_REQUIRES_CONFIRMATION' }),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<CheckpointsPanel site={site} />);
    await user.click(await screen.findByRole('button', { name: 'Agregar punto' }));
    await user.type(await screen.findByLabelText('Nombre del punto'), 'Torre');
    fireEvent.change(await screen.findByLabelText('Latitud'), { target: { value: '-34' } });
    fireEvent.change(screen.getByLabelText('Longitud'), { target: { value: '-58' } });
    await user.click(screen.getByRole('button', { name: 'Crear punto' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('más de 1 km del predio');
    await user.click(screen.getByRole('button', { name: 'Confirmar ubicación' }));
    await waitFor(() => {
      expect(post).toHaveBeenCalledTimes(2);
    });
    expect(post.mock.calls[1]?.[1]).toMatchObject({ confirmFarLocation: true });
  });

  it('muestra la ronda que bloquea la baja', async () => {
    setRole('admin');
    jest.mocked(apiGet).mockResolvedValueOnce([
      {
        id: 'point-1',
        siteId: site.id,
        name: 'Portón',
        latitude: -34.6,
        longitude: -58.4,
        toleranceRadiusMeters: 30,
        stickerLocation: null,
        isIndoor: false,
        qrVersion: 1,
        status: 'active',
      },
    ] as never);
    jest.mocked(apiPost).mockRejectedValueOnce(
      new ApiError('conflicto', 409, {
        code: 'CHECKPOINT_IN_ACTIVE_ROUNDS',
        rounds: [{ id: 'round-1', name: 'Perimetral' }],
      }),
    );
    const user = userEvent.setup();
    renderWithQueryClient(<CheckpointsPanel site={site} />);
    await user.click(await screen.findByRole('button', { name: 'Más acciones de Portón' }));
    await user.click(screen.getByRole('menuitem', { name: 'Dar de baja' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar baja' }));
    expect(
      await screen.findByText('No se puede dar de baja: está incluida en Perimetral.'),
    ).toBeInTheDocument();
  });

  it('pide confirmación antes de regenerar un QR impreso', async () => {
    setRole('admin');
    jest.mocked(apiGet).mockResolvedValueOnce([
      {
        id: 'point-1',
        siteId: site.id,
        name: 'Portón',
        latitude: -34.6,
        longitude: -58.4,
        toleranceRadiusMeters: 30,
        stickerLocation: null,
        isIndoor: false,
        qrVersion: 1,
        status: 'active',
      },
    ] as never);
    const confirmSpy = jest.fn(() => false);
    window.confirm = confirmSpy;
    const user = userEvent.setup();
    renderWithQueryClient(<CheckpointsPanel site={site} />);
    await user.click(await screen.findByRole('button', { name: 'Más acciones de Portón' }));
    await user.click(screen.getByRole('menuitem', { name: 'Regenerar QR' }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('dejará de ser válido'));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('mantiene el supervisor en solo lectura', async () => {
    setRole('supervisor');
    renderWithQueryClient(<CheckpointsPanel site={site} />);
    expect(await screen.findByText('Puntos de control')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear punto' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Descargar stickers de todos' }),
    ).not.toBeInTheDocument();
  });
});

it('no ofrece imprimir una lista vacia y cierra el alta al guardar', async () => {
  setRole('admin');
  jest.mocked(apiGet).mockResolvedValue([] as never);
  const user = userEvent.setup();
  renderWithQueryClient(<CheckpointsPanel site={site} />);
  await waitFor(() => {
    expect(screen.queryByText('Cargando puntos…')).not.toBeInTheDocument();
  });
  expect(
    screen.queryByRole('button', { name: 'Descargar stickers de todos' }),
  ).not.toBeInTheDocument();
  await user.click(await screen.findByRole('button', { name: 'Agregar punto' }));
  await user.type(await screen.findByLabelText('Nombre del punto'), 'Nuevo punto');
  await user.click(screen.getByRole('button', { name: 'Crear punto' }));
  await screen.findByText('Punto guardado.');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Agregar punto' }));
  expect(screen.getByLabelText('Nombre del punto')).toHaveValue('');
  expect(screen.getByLabelText('Radio de tolerancia (m)')).toHaveValue(30);
});
it('cancelar la edición cierra el modal y deja el alta vacía y regenerar QR refresca puntos', async () => {
  setRole('admin');
  jest.mocked(apiGet).mockResolvedValue([
    {
      id: 'p',
      siteId: site.id,
      name: 'Porton',
      latitude: -34.6,
      longitude: -58.4,
      toleranceRadiusMeters: 100,
      stickerLocation: 'Pared',
      isIndoor: true,
      qrVersion: 1,
      status: 'active',
    },
  ] as never);
  const user = userEvent.setup();
  renderWithQueryClient(<CheckpointsPanel site={site} />);
  await user.click(await screen.findByRole('button', { name: 'Más acciones de Porton' }));
  await user.click(screen.getByRole('menuitem', { name: 'Editar' }));
  expect(screen.getByRole('dialog', { name: 'Editar punto' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Agregar punto' }));
  expect(screen.getByRole('dialog', { name: 'Nuevo punto' })).toBeInTheDocument();
  expect(screen.getByLabelText('Nombre del punto')).toHaveValue('');
  expect(screen.getByLabelText('Radio de tolerancia (m)')).toHaveValue(30);
  expect(screen.getByLabelText('Descripción de ubicación del sticker (opcional)')).toHaveValue('');
  expect(screen.getByLabelText('Punto interior')).not.toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Cancelar' }));
  const reads = jest.mocked(apiGet).mock.calls.length;
  await user.click(screen.getByRole('button', { name: 'Más acciones de Porton' }));
  await user.click(screen.getByRole('menuitem', { name: 'Regenerar QR' }));
  await screen.findByText('QR regenerado. Imprimí un sticker nuevo.');
  expect(jest.mocked(apiGet).mock.calls.length).toBeGreaterThan(reads);
});

it('renumera en el modo edición y guarda todo junto recién con Guardar', async () => {
  setRole('admin');
  const point = (id: string, name: string) => ({
    id,
    siteId: site.id,
    name,
    latitude: -34.6,
    longitude: -58.4,
    toleranceRadiusMeters: 30,
    stickerLocation: null,
    isIndoor: false,
    qrVersion: 1,
    status: 'active',
  });
  jest
    .mocked(apiGet)
    .mockResolvedValue([point('a', 'Alfa'), point('b', 'Beta'), point('c', 'Gama')]);
  const actions = document.createElement('div');
  document.body.append(actions);
  const user = userEvent.setup();
  renderWithQueryClient(<CheckpointsPanel site={site} actions={actions} />);
  await user.click(await screen.findByRole('button', { name: 'Mantené un pin para editar' }));
  // El de la tabla (el otro es el del mapa): se abre un solo campo y no se cierra solo.
  const [inTable] = screen.getAllByRole('button', { name: 'Cambiar el número de Gama (ahora 3)' });
  if (!inTable) throw new Error('Falta el N° de Gama');
  await user.click(inTable);
  expect(screen.getAllByLabelText('Nuevo número de Gama')).toHaveLength(1);
  await user.clear(screen.getByLabelText('Nuevo número de Gama'));
  await user.type(screen.getByLabelText('Nuevo número de Gama'), '1{Enter}');
  expect(apiPatch).not.toHaveBeenCalled();
  expect(screen.getAllByRole('row').map((row) => row.textContent)).toEqual([
    expect.stringContaining('Punto') as unknown,
    expect.stringMatching(/^1Gama/) as unknown,
    expect.stringMatching(/^2Alfa/) as unknown,
    expect.stringMatching(/^3Beta/) as unknown,
  ]);
  await user.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(apiPatch).toHaveBeenCalledWith(
    '/predios/site-1/puntos/orden',
    {
      puntos: ['c', 'a', 'b'].map((id) => ({ id, latitude: -34.6, longitude: -58.4 })),
      confirmFarLocation: false,
    },
    expect.anything(),
    expect.anything(),
  );
  actions.remove();
});
