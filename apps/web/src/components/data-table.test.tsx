import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { compareValues } from '@/lib/compare-values';
import { DataTable, type DataColumn } from './data-table';

interface Row {
  id: string;
  name: string;
  count: number | null;
  date: string;
}
const rows: Row[] = [
  { id: 'a', name: 'Ñandú', count: 10, date: '2026-11-03' },
  { id: 'b', name: 'abeja', count: null, date: '2026-11-01' },
  { id: 'c', name: 'Zorro', count: 2, date: '2026-11-02' },
];
const columns: DataColumn<Row>[] = [
  { id: 'name', header: 'Nombre', value: (r) => r.name },
  { id: 'count', header: 'Cantidad', type: 'number', value: (r) => r.count, align: 'right' },
  { id: 'date', header: 'Fecha', type: 'date', value: (r) => r.date },
];
const firstColumn = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);
const headers = () => screen.getAllByRole('columnheader').map((th) => th.textContent);

it('compara por tipo y deja los vacíos al final', () => {
  expect(compareValues(2, 10, 'number')).toBeLessThan(0);
  expect(compareValues('item 2', 'item 10')).toBeLessThan(0);
  expect(compareValues('abeja', 'Ñandú')).toBeLessThan(0);
  expect(compareValues('2026-01-02', '2025-12-31', 'date')).toBeGreaterThan(0);
  expect(compareValues(null, 1, 'number')).toBeGreaterThan(0);
  // NaN y fechas inválidas cuentan como vacías: no rompen el orden.
  expect(compareValues(Number.NaN, 1, 'number')).toBeGreaterThan(0);
  expect(compareValues('no es fecha', '2026-01-01', 'date')).toBeGreaterThan(0);
});

it('sin orden en listas paginadas, y respeta el ancho de columnas que aparecen después', async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <DataTable
      label="Animales"
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      sortable={false}
    />,
  );
  await user.click(screen.getByRole('button', { name: /Cantidad/ }));
  expect(screen.getByRole('columnheader', { name: /Cantidad/ })).not.toHaveAttribute('aria-sort');
  expect(firstColumn()).toEqual(['Ñandú', 'abeja', 'Zorro']);
  rerender(
    <DataTable
      label="Animales"
      rows={rows}
      columns={[...columns, { id: 'actions', header: 'Acciones', hideHeader: true, width: 56 }]}
      getRowId={(r) => r.id}
    />,
  );
  expect(screen.getByRole('separator', { name: 'Ancho de Acciones' })).toHaveAttribute(
    'aria-valuenow',
    '56',
  );
});

it('ordena al hacer clic: ascendente, descendente y sin orden', async () => {
  const user = userEvent.setup();
  render(<DataTable label="Animales" rows={rows} columns={columns} getRowId={(r) => r.id} />);
  const count = screen.getByRole('button', { name: /Cantidad/ });
  await user.click(count);
  expect(screen.getByRole('columnheader', { name: /Cantidad/ })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  // Fila con cantidad vacía al final también en descendente.
  const counts = () =>
    screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[1]?.textContent);
  expect(counts()).toEqual(['2', '10', '']);
  await user.click(count);
  expect(counts()).toEqual(['10', '2', '']);
  await user.click(count);
  expect(firstColumn()).toEqual(['Ñandú', 'abeja', 'Zorro']);
  await user.click(screen.getByRole('button', { name: /Nombre/ }));
  expect(firstColumn()).toEqual(['abeja', 'Ñandú', 'Zorro']);
});

it('mueve una columna con Alt+flechas y lo anuncia', async () => {
  const user = userEvent.setup();
  render(<DataTable label="Animales" rows={rows} columns={columns} getRowId={(r) => r.id} />);
  screen.getByRole('button', { name: /Fecha/ }).focus();
  await user.keyboard('{Alt>}{ArrowLeft}{ArrowLeft}{/Alt}');
  expect(headers()[0]).toMatch(/Fecha/);
  expect(firstColumn()).toEqual(['2026-11-03', '2026-11-01', '2026-11-02']);
  expect(screen.getByRole('status')).toHaveTextContent('Fecha: columna 1 de 3');
});

it('ensancha una columna con el teclado', async () => {
  const user = userEvent.setup();
  render(<DataTable label="Animales" rows={rows} columns={columns} getRowId={(r) => r.id} />);
  const handle = screen.getByRole('separator', { name: 'Ancho de Nombre' });
  handle.focus();
  await user.keyboard('{ArrowRight}');
  expect(Number(handle.getAttribute('aria-valuenow'))).toBeGreaterThan(48);
});
