import { render, screen } from '@testing-library/react';

import { Stamp } from './stamp';

it('muestra el texto y la variante por defecto en tinta', () => {
  render(<Stamp>08:15</Stamp>);
  expect(screen.getByText('08:15')).toHaveAttribute('data-variant', 'normal');
});

it('cada variante cambia la forma, no solo el color', () => {
  render(
    <>
      <Stamp variant="late">tarde</Stamp>
      <Stamp variant="fail">falla</Stamp>
      <Stamp variant="dashed">sin señal</Stamp>
      <Stamp variant="now">ahora</Stamp>
    </>,
  );
  expect(screen.getByText('tarde')).toHaveClass('text-warning');
  expect(screen.getByText('falla')).toHaveClass('-rotate-2', 'outline-1');
  expect(screen.getByText('sin señal')).toHaveClass('border-dashed');
  expect(screen.getByText('ahora')).toHaveClass('bg-primary');
});

it('check agrega la tilde decorativa', () => {
  const { container } = render(<Stamp check>Registrado</Stamp>);
  expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
});
