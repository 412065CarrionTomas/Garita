import { screen } from '@testing-library/react';

import { renderWithQueryClient } from '@/test/render';

import { ApiStatus } from './api-status';

const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: () => Promise.resolve(body) } as Response;
}

describe('ApiStatus', () => {
  it('muestra que la API está conectada cuando responde correctamente', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: 'ok', timestamp: new Date().toISOString() }),
    );

    renderWithQueryClient(<ApiStatus />);

    expect(await screen.findByText('API conectada')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/v1/health/live',
      expect.objectContaining({ headers: expect.any(Headers) as Headers }),
    );
  });

  it('muestra que no hay conexión cuando la API falla', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));

    renderWithQueryClient(<ApiStatus />);

    expect(await screen.findByText('API sin conexión')).toBeInTheDocument();
  });

  it('muestra que no hay conexión si la respuesta no cumple el contrato', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'roto' }));

    renderWithQueryClient(<ApiStatus />);

    expect(await screen.findByText('API sin conexión')).toBeInTheDocument();
  });
});
