import { render, screen } from '@testing-library/react-native';

import { ApiStatus } from './api-status';

let fetchMock: jest.SpiedFunction<typeof fetch>;

beforeEach(() => {
  fetchMock = jest.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  fetchMock.mockRestore();
});

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: () => Promise.resolve(body) } as Response;
}

describe('<ApiStatus />', () => {
  it('anuncia que está verificando la conexión mientras espera la API', async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    await render(<ApiStatus />);
    expect(screen.getByText('Verificando conexión…')).toBeOnTheScreen();
    expect(
      screen
        .getAllByRole('text')
        .some((element) => element.props.accessibilityLiveRegion === 'polite'),
    ).toBe(true);
  });

  it('muestra que la API está conectada cuando responde correctamente', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: 'ok', timestamp: new Date().toISOString() }),
    );

    await render(<ApiStatus />);

    expect(await screen.findByText('API conectada')).toBeOnTheScreen();
    expect(
      screen
        .getAllByRole('text')
        .some((element) => element.props.accessibilityLiveRegion === 'polite'),
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/v1/health/live',
      expect.objectContaining({ headers: expect.any(Headers) as Headers }),
    );
  });

  it('muestra que no hay conexión cuando la API falla', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    await render(<ApiStatus />);

    expect(await screen.findByText('API sin conexión')).toBeOnTheScreen();
  });
});
