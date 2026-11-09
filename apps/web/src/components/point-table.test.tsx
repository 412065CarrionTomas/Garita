import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PointTable, type PointTableRow } from './point-table';

const rows: PointTableRow[] = Array.from({ length: 8 }, (_, i) => ({
  id: `p${i}`,
  label: `Punto ${i}`,
  scheduledAt: `08:0${i}`,
  registeredAt: i < 4 ? `08:0${i}` : null,
  status: i < 3 ? 'done' : i === 3 ? 'missed' : i === 4 ? 'next' : 'pending',
}));

const scrollTo = jest.fn();

beforeEach(() => {
  scrollTo.mockClear();
  HTMLElement.prototype.scrollTo = scrollTo;
  // jsdom no calcula layout: encabezado y filas de 50 px; la fila k queda en 50 + 50k.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 50 });
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === 'TR' ? 50 + (this as HTMLTableRowElement).sectionRowIndex * 50 : 0;
    },
  });
});

it('muestra las columnas y arranca dos filas antes del punto actual', () => {
  render(<PointTable rows={rows} />);
  for (const c of ['N°', 'Punto', 'Prevista', 'Registrada', 'Estado']) {
    expect(screen.getByRole('columnheader', { name: c })).toBeInTheDocument();
  }
  // actual = fila 4; primera visible = fila 2 (offsetTop 150) menos el encabezado (50).
  expect(scrollTo).toHaveBeenCalledWith({ top: 100, behavior: 'auto' });
});

it('filtra por pendientes y sin registro y avisa la selección', async () => {
  const onSelect = jest.fn();
  render(<PointTable rows={rows} selectedId="p4" onSelect={onSelect} />);

  await userEvent.click(screen.getByRole('button', { name: 'Sin registro' }));
  expect(screen.getByRole('button', { name: 'Sin registro' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(document.querySelectorAll('tbody tr')).toHaveLength(1);

  await userEvent.click(screen.getByRole('button', { name: 'Pendientes' }));
  expect(document.querySelectorAll('tbody tr')).toHaveLength(4);

  await userEvent.click(screen.getByRole('button', { name: 'Punto 4' }));
  expect(onSelect).toHaveBeenCalledWith('p4');
});

it('marca el botón de la fila seleccionada', () => {
  render(<PointTable rows={rows} selectedId="p2" />);
  expect(screen.getByRole('button', { name: 'Punto 2' })).toHaveAttribute('aria-pressed', 'true');
});
