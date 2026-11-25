import { fireEvent, screen } from '@testing-library/react';
import { renderWithQueryClient } from '@/test/render';
import { LiveMapView } from './live-map-view';

// jsdom no trae Response: alcanza con lo que lee useMapStyle.
const styleResponse = (ok: boolean) =>
  ({
    ok,
    status: ok ? 200 : 503,
    json: () => Promise.resolve({ version: 8, sources: {}, layers: [] }),
  }) as Response;

beforeEach(() => {
  jest.mocked(fetch).mockResolvedValue(styleResponse(true));
});

it('muestra predios y puntos como botones accesibles sobre el mapa', async () => {
  const onSelectSite = jest.fn();
  const onSelectPoint = jest.fn();
  renderWithQueryClient(
    <LiveMapView
      sites={[
        {
          id: 's1',
          name: 'Planta Norte',
          lat: -31.4,
          lng: -64.2,
          label: '3/8',
          description: '3 de 8 ventanas completas',
          state: 'normal',
        },
      ]}
      selectedSiteId="s1"
      onSelectSite={onSelectSite}
      points={[
        { id: 'p1', name: 'Portón', lat: -31.4, lng: -64.2, status: 'done' },
        { id: 'p2', name: 'Depósito', lat: -31.41, lng: -64.21, status: 'next' },
      ]}
      onSelectPoint={onSelectPoint}
    />,
  );
  const site = await screen.findByRole('button', {
    name: 'Planta Norte: 3 de 8 ventanas completas',
  });
  expect(site).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(site);
  expect(onSelectSite).toHaveBeenCalledWith('s1');
  fireEvent.click(screen.getByRole('button', { name: 'Punto 2, Depósito: Próximo' }));
  expect(onSelectPoint).toHaveBeenCalledWith('p2');
});

it('avisa cuando no se puede descargar el estilo del mapa', async () => {
  jest.mocked(fetch).mockResolvedValue(styleResponse(false));
  renderWithQueryClient(<LiveMapView sites={[]} />);
  expect(await screen.findByText('No se pudo cargar el mapa', {}, { timeout: 5000 })).toBeVisible();
});

it('cambia a la vista satelital y recuerda la elección', async () => {
  renderWithQueryClient(<LiveMapView sites={[]} />);
  const satellite = await screen.findByRole('button', { name: 'Satélite' });
  expect(satellite).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(satellite);
  expect(satellite).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Mapa' })).toHaveAttribute('aria-pressed', 'false');
  expect(localStorage.getItem('garita.map.satellite')).toBe('on');
  localStorage.clear();
});
