import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PointPath, type PathPoint } from './point-path';

const points: PathPoint[] = [
  { id: 'p1', label: 'Portón', status: 'done' },
  { id: 'p2', label: 'Garita', status: 'missed' },
  { id: 'p3', label: 'Depósito', status: 'next' },
  { id: 'p4', label: 'Patio', status: 'pending' },
];

it('es un grupo con un botón accesible por punto', () => {
  render(<PointPath points={points} selectedId="p3" />);
  expect(screen.getByRole('group', { name: 'Camino de la ronda' })).toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(4);
  expect(screen.getByRole('button', { name: 'Punto 2, Garita: Sin registro' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(screen.getByRole('button', { name: 'Punto 3, Depósito: Próximo' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

it('avisa el punto elegido con clic y con teclado', async () => {
  const onSelect = jest.fn();
  render(<PointPath points={points} onSelect={onSelect} />);
  await userEvent.click(screen.getByRole('button', { name: /Portón/ }));
  expect(onSelect).toHaveBeenLastCalledWith('p1');

  screen.getByRole('button', { name: /Patio/ }).focus();
  await userEvent.keyboard('{Enter}');
  expect(onSelect).toHaveBeenLastCalledWith('p4');
});

it('serpentea en filas de 10 sin romper con rondas largas', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    id: `x${i}`,
    label: `P${i}`,
    status: 'pending' as const,
  }));
  render(<PointPath points={many} />);
  expect(screen.getAllByRole('button')).toHaveLength(25);
});
