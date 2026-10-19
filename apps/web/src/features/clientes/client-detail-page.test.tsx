import { screen } from '@testing-library/react';
import { apiGet } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { ClientDetailPage } from './clients-page';

jest.mock('react-router', () => ({ useParams: () => ({ id: 'client-1' }) }));
jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn() }));

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
    expect(screen.getByRole('status')).toHaveTextContent('El mapa no está configurado');
  });

  it('explica el estado vacío cuando el cliente no tiene predios activos', async () => {
    jest.mocked(apiGet).mockResolvedValueOnce({ ...client, sites: [] });
    renderWithQueryClient(<ClientDetailPage />);
    expect(await screen.findByText('Este cliente no tiene predios activos.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
