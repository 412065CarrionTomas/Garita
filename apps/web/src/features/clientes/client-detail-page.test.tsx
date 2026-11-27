import { screen } from '@testing-library/react';
import { apiGet } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { useAuth } from '../auth/auth-context';
import { ClientDetailPage } from './clients-page';

jest.mock('../auth/auth-context', () => ({
  useAuth: jest.fn(() => ({ user: { role: 'admin' } })),
}));
jest.mock('react-router', () => ({
  ...jest.requireActual<object>('react-router'),
  useParams: () => ({ id: 'client-1' }),
}));
jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn(), apiPost: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(apiGet).mockResolvedValue([]);
  jest.mocked(useAuth).mockReturnValue({ user: { role: 'admin' } } as ReturnType<typeof useAuth>);
});

const client = {
  id: 'client-1',
  name: 'Cliente Norte',
  contactName: 'Ana',
  phone: '+541112345678',
  email: 'ana@example.invalid',
  taxId: null,
  status: 'active',
  sites: [
    {
      id: 'site-1',
      name: 'Predio activo',
      address: 'Calle 1',
      latitude: -34,
      longitude: -58,
      status: 'active',
    },
    {
      id: 'site-2',
      name: 'Predio inactivo',
      address: 'Calle 2',
      latitude: -35,
      longitude: -59,
      status: 'inactive',
    },
  ],
};

describe('ClientDetailPage', () => {
  it('muestra el estado, el contacto y solo los predios activos con enlace de vuelta', async () => {
    jest.mocked(apiGet).mockResolvedValueOnce(client);
    renderWithQueryClient(<ClientDetailPage />);
    expect(await screen.findByRole('heading', { name: 'Cliente Norte' })).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('ana@example.invalid')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a Clientes' })).toHaveAttribute(
      'href',
      '/clientes',
    );
    expect(screen.getByRole('cell', { name: 'Predio activo' })).toBeInTheDocument();
    expect(screen.queryByText('Predio inactivo')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Usuarios del portal' })).toBeInTheDocument();
  });

  it('explica el estado vacío cuando el cliente no tiene predios activos', async () => {
    jest.mocked(apiGet).mockResolvedValueOnce({ ...client, sites: [] });
    renderWithQueryClient(<ClientDetailPage />);
    expect(await screen.findByText('Este cliente no tiene predios activos.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('oculta la gestion del portal a los supervisores', async () => {
    jest
      .mocked(useAuth)
      .mockReturnValue({ user: { role: 'supervisor' } } as ReturnType<typeof useAuth>);

    jest.mocked(apiGet).mockResolvedValueOnce(client);

    renderWithQueryClient(<ClientDetailPage />);

    await screen.findByRole('heading', { name: 'Cliente Norte' });

    expect(screen.queryByRole('heading', { name: 'Usuarios del portal' })).not.toBeInTheDocument();

    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});
