import { render, screen } from '@testing-library/react';
import { pageNumbers } from '@/lib/page-numbers';
import { Pagination } from './pagination';

describe('pageNumbers', () => {
  it('muestra primera, anterior, actual, siguiente y última con saltos solo donde faltan páginas', () => {
    expect(pageNumbers(1, 8)).toEqual([1, 2, null, 8]);
    expect(pageNumbers(5, 8)).toEqual([1, null, 4, 5, 6, null, 8]);
    expect(pageNumbers(3, 8)).toEqual([1, 2, 3, 4, null, 8]);
    expect(pageNumbers(8, 8)).toEqual([1, null, 7, 8]);
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(1, 0)).toEqual([1]);
  });
});

it('no ofrece botones de anterior ni siguiente', () => {
  render(
    <Pagination
      page={1}
      pages={8}
      pageSize={5}
      total={40}
      shown={5}
      onPageChange={jest.fn()}
      onPageSizeChange={jest.fn()}
    />,
  );
  expect(screen.queryByRole('button', { name: /Siguiente|Anterior/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Página 1' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('1–5 de 40')).toBeInTheDocument();
});
