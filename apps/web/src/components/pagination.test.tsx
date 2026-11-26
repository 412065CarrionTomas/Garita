import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { pageNumbers } from '@/lib/page-numbers';
import { Pagination } from './pagination';

describe('pageNumbers', () => {
  it('muestra primera, anterior, actual, siguiente y última con saltos solo donde faltan páginas', () => {
    expect(pageNumbers(1, 8)).toEqual([1, 2, null, 8]);
    expect(pageNumbers(5, 9)).toEqual([1, null, 4, 5, 6, null, 9]);
    expect(pageNumbers(3, 8)).toEqual([1, 2, 3, 4, null, 8]);
    expect(pageNumbers(8, 8)).toEqual([1, null, 7, 8]);
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(1, 0)).toEqual([1]);
  });

  it('muestra la página en lugar de un salto que taparía solo una', () => {
    expect(pageNumbers(1, 4)).toEqual([1, 2, 3, 4]);
    expect(pageNumbers(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('no recorre todas las páginas cuando hay muchas', () => {
    expect(pageNumbers(50000, 100000)).toEqual([1, null, 49999, 50000, 50001, null, 100000]);
  });
});

const renderPagination = (props: Partial<Parameters<typeof Pagination>[0]> = {}) => {
  const handlers = { onPageChange: jest.fn(), onPageSizeChange: jest.fn() };
  render(<Pagination page={1} pages={8} pageSize={5} total={40} {...handlers} {...props} />);
  return handlers;
};

it('no ofrece anterior ni siguiente y navega por número y tamaño', async () => {
  const { onPageChange, onPageSizeChange } = renderPagination();
  expect(screen.queryByRole('button', { name: /Siguiente|Anterior/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Página 1' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('1–5 de 40')).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Página 2' }));
  expect(onPageChange).toHaveBeenCalledWith(2);
  await user.selectOptions(screen.getByLabelText('Por página'), '50');
  expect(onPageSizeChange).toHaveBeenCalledWith(50);
});

it('acota el fin del rango al total', () => {
  renderPagination({ page: 2, pages: 2, pageSize: 20, total: 25 });
  expect(screen.getByText('21–25 de 25')).toBeInTheDocument();
});

it('muestra "Sin resultados" sin páginas', () => {
  renderPagination({ pages: 0, total: 0 });
  expect(screen.getByText('Sin resultados')).toBeInTheDocument();
});

it('vuelve a la última página si la actual quedó vacía tras una baja', () => {
  const { onPageChange } = renderPagination({ page: 2, pages: 1, pageSize: 20, total: 20 });
  expect(onPageChange).toHaveBeenCalledWith(1);
  expect(screen.queryByText(/21–20/)).not.toBeInTheDocument();
});
