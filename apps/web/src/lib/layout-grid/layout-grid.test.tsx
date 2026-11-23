import { render, screen } from '@testing-library/react';
import { adminSummaryCatalog, type LayoutItem } from '@garita/shared';
import { LayoutGrid } from './layout-grid';

const items: LayoutItem[] = adminSummaryCatalog.defaultLayout.items.map((item) =>
  item.id === 'account' ? { ...item, hidden: true } : item,
);

function renderGrid() {
  render(
    <LayoutGrid
      catalog={adminSummaryCatalog}
      items={items}
      aria-label="Bloques"
      renderItem={(item) => <p>{item.id}</p>}
    />,
  );
  return [...document.querySelectorAll<HTMLElement>('[data-layout-item]')];
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

it('ubica cada bloque visible en la grilla, en orden de lectura', () => {
  const cells = renderGrid();
  // Orden de lectura: fila y después columna; los ocultos no se dibujan.
  expect(cells.map((cell) => cell.dataset.layoutItem)).toEqual([
    'attention',
    'compliance',
    'shiftsToday',
    'incidents',
    'sites',
    'guards',
  ]);
  expect(screen.queryByText('account')).toBeNull();
  const compliance = cells[1];
  expect(compliance?.style.gridColumn).toBe('1 / span 16');
  expect(compliance?.style.gridRow).toBe('19 / span 24');
});

it('en celular apila los bloques en una sola columna', () => {
  window.matchMedia = jest.fn().mockReturnValue({
    matches: false,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  });
  const cells = renderGrid();
  expect(cells.every((cell) => cell.style.gridColumn === '1 / span 1')).toBe(true);
  // Alto natural: sin fila fija, para que se desplace la página y no cada bloque.
  expect(cells.every((cell) => cell.style.gridRow === '')).toBe(true);
  expect(cells.map((cell) => cell.dataset.layoutItem)).toEqual([
    'attention',
    'compliance',
    'shiftsToday',
    'incidents',
    'sites',
    'guards',
  ]);
});
