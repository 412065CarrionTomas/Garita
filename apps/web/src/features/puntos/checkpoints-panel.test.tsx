import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient } from '@/test/render';
import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';
import { CheckpointsPanel } from './checkpoints-panel';

jest.mock('../auth/auth-context', () => ({ useAuth: jest.fn() }));
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

  it('valida el radio de tolerancia fuera del rango permitido', async () => {
    setRole('admin');
    const user = userEvent.setup();
    renderWithQueryClient(<CheckpointsPanel site={site} />);
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
    await user.type(await screen.findByLabelText('Nombre del punto'), 'Torre');
    fireEvent.change(screen.getByLabelText('Latitud'), { target: { value: '-34' } });
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
    await user.click(await screen.findByRole('button', { name: 'Dar de baja' }));
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
    await user.click(await screen.findByRole('button', { name: 'Regenerar QR' }));
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
