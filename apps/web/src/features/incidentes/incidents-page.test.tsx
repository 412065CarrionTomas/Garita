import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { apiGet } from '@/lib/api-client';
import { renderWithQueryClient } from '@/test/render';
import { IncidentsListPage, IncidentsQueuePage } from './incidents-page';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn(), apiPost: jest.fn() }));

const incident = {
  id: 'incident-1',
  type: 'intrusion',
  description: null,
  createdAt: '2026-10-20T00:00:00.000Z',
  site: { id: 'site-1', name: 'Predio A' },
  guard: { firstName: 'Pedro', lastName: 'Díaz', status: 'deactivated' },
  classificationStatus: 'pending',
  overdue: true,
};

it('muestra la cola antigua con estado textual y acceso por teclado', async () => {
  jest.mocked(apiGet).mockResolvedValueOnce([incident]);
  renderWithQueryClient(
    <MemoryRouter>
      <IncidentsQueuePage />
    </MemoryRouter>,
  );
  expect(await screen.findByText('Más de 24 h pendiente')).toBeInTheDocument();
  expect(screen.getByText('Pendiente de clasificación')).toBeInTheDocument();
  expect(screen.getByText(/Pedro Díaz \(desactivado\)/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Ver detalle' })).toHaveAttribute(
    'href',
    '/incidentes/incident-1',
  );
});

it('envía los filtros del listado a la consulta y conserva etiquetas accesibles', async () => {
  jest
    .mocked(apiGet)
    .mockImplementation((path) =>
      Promise.resolve(
        path === '/predios'
          ? [{ id: 'site-1', name: 'Predio A' }]
          : { items: [incident], total: 1, page: 1, pageSize: 25 },
      ),
    );
  renderWithQueryClient(
    <MemoryRouter>
      <IncidentsListPage />
    </MemoryRouter>,
  );
  await screen.findByText('Intrusión · Predio A');
  fireEvent.change(screen.getByLabelText('Predio'), { target: { value: 'site-1' } });
  fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'intrusion' } });
  fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'pending' } });
  expect(
    jest
      .mocked(apiGet)
      .mock.calls.some(
        ([path]) =>
          typeof path === 'string' &&
          path.includes('predio=site-1') &&
          path.includes('tipo=intrusion') &&
          path.includes('clasificacion=pending'),
      ),
  ).toBe(true);
});
