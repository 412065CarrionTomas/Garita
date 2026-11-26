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
