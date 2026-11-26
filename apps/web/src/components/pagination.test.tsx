import { fireEvent, render, screen } from '@testing-library/react';
import { pageItems } from '@/lib/page-items';
import { Pagination } from './pagination';

describe('pageItems', () => {
  it('muestra primera … anterior, actual, siguiente … última, solo lo que existe', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(1, 2)).toEqual([1, 2]);
    expect(pageItems(1, 9)).toEqual([1, 2, 'gap', 9]);
    expect(pageItems(3, 9)).toEqual([1, 2, 3, 4, 'gap', 9]);
    expect(pageItems(5, 9)).toEqual([1, 'gap', 4, 5, 6, 'gap', 9]);
    expect(pageItems(8, 9)).toEqual([1, 'gap', 7, 8, 9]);
    expect(pageItems(9, 9)).toEqual([1, 'gap', 8, 9]);
    // Una página que ya no existe se muestra como la última.
    expect(pageItems(3, 2)).toEqual([1, 2]);
    expect(pageItems(1, 0)).toEqual([1]);
  });
});

it('cambia de página y de tamaño', () => {
  const onPage = jest.fn();
  const onPageSize = jest.fn();
  render(
    <Pagination
      page={1}
      pageSize={10}
      total={45}
      shown={10}
      label="alertas"
      onPage={onPage}
      onPageSize={onPageSize}
    />,
  );
  expect(screen.getByText('1–10 de 45')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Página 1' })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(screen.getByRole('button', { name: 'Página 5' }));
  expect(onPage).toHaveBeenCalledWith(5);
  fireEvent.change(screen.getByLabelText('Por página'), { target: { value: '20' } });
  expect(onPageSize).toHaveBeenCalledWith(20);
});

it('sin filas en la página no muestra un rango imposible', () => {
  render(
    <Pagination
      page={3}
      pageSize={10}
      total={20}
      shown={0}
      label="alertas"
      onPage={jest.fn()}
      onPageSize={jest.fn()}
    />,
  );
  expect(screen.getByText('0 de 20')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Página 2' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('button', { name: 'Página 3' })).not.toBeInTheDocument();
});
