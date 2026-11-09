import { render, screen } from '@testing-library/react';

import { StatusBadge } from './status-badge';

it('usa un sello cuya variante depende del tono', () => {
  render(
    <>
      <StatusBadge tone="warning">Tardía</StatusBadge>
      <StatusBadge tone="danger">Sin registro</StatusBadge>
      <StatusBadge tone="neutral">Interno</StatusBadge>
    </>,
  );
  expect(screen.getByText('Tardía')).toHaveAttribute('data-variant', 'late');
  expect(screen.getByText('Sin registro')).toHaveAttribute('data-variant', 'fail');
  expect(screen.getByText('Interno')).toHaveAttribute('data-variant', 'dashed');
});

it('el tono success lleva tilde', () => {
  const { container } = render(<StatusBadge tone="success">Cerrado</StatusBadge>);
  expect(container.querySelector('svg')).toBeInTheDocument();
});
