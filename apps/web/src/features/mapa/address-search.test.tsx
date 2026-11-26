import { useState } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQueryClient } from '@/test/render';
import { AddressSearch } from './address-search';

beforeEach(() => {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        features: [
          {
            geometry: { coordinates: [-58, -34] },
            properties: { name: 'Primera', city: 'Ciudad' },
          },
          { geometry: { coordinates: [-59, -35] }, properties: { name: 'Ultima', city: 'Ciudad' } },
        ],
      }),
  });
});
it('Enter nunca envia el formulario, ni sin lista ni sin seleccion activa', async () => {
  const submit = jest.fn((e: React.SyntheticEvent) => {
    e.preventDefault();
  });
  renderWithQueryClient(
    <form onSubmit={submit}>
      <AddressSearch onSelect={jest.fn()} />
    </form>,
  );
  const input = screen.getByRole('combobox');
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
  fireEvent.change(input, { target: { value: 'Calle' } });
  await screen.findAllByRole('option');
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});
it('ArrowUp desde -1 elige la ultima y elegir no busca de nuevo', async () => {
  const select = jest.fn();
  renderWithQueryClient(<AddressSearch onSelect={select} />);
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'Calle' } });
  await screen.findAllByRole('option');
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(select).toHaveBeenCalledWith(-35, -59, 'Ultima, Ciudad');
  await new Promise((resolve) => setTimeout(resolve, 450));
  expect(fetch).toHaveBeenCalledTimes(1);
  await waitFor(() => {
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
it('prioriza lo cercano a `near` y, sin ubicación (0, 0), la zona por defecto', async () => {
  const { unmount } = renderWithQueryClient(
    <AddressSearch onSelect={jest.fn()} near={{ latitude: -33.1234, longitude: -64.3456 }} />,
  );
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Calle' } });
  await screen.findAllByRole('option');
  const url = new URL(jest.mocked(fetch).mock.calls[0]?.[0] as string);
  expect(url.searchParams.get('lat')).toBe('-33.123');
  expect(url.searchParams.get('lon')).toBe('-64.346');
  expect(url.searchParams.getAll('layer')).not.toContain('state');
  unmount();
  renderWithQueryClient(
    <AddressSearch onSelect={jest.fn()} near={{ latitude: 0, longitude: 0 }} />,
  );
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Calle' } });
  await screen.findAllByRole('option');
  const fallback = new URL(jest.mocked(fetch).mock.calls[1]?.[0] as string);
  expect(fallback.searchParams.get('lat')).toBe('-31.400');
});
it('con la lista cerrada, mover la referencia no vuelve a buscar', async () => {
  function Harness() {
    const [near, setNear] = useState({ latitude: -31.4, longitude: -64.18 });
    return (
      <>
        <AddressSearch onSelect={jest.fn()} near={near} />
        <button
          type="button"
          onClick={() => {
            setNear({ latitude: -31.5, longitude: -64.3 });
          }}
        >
          Mover
        </button>
      </>
    );
  }
  renderWithQueryClient(<Harness />);
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'Calle' } });
  await screen.findAllByRole('option');
  fireEvent.blur(input);
  fireEvent.click(screen.getByRole('button', { name: 'Mover' }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(fetch).toHaveBeenCalledTimes(1);
});
