import { render, screen } from '@testing-library/react';

import { WindowBar } from './window-bar';

it('describe las ventanas en español', () => {
  render(
    <WindowBar
      windows={[
        { status: 'ontime' },
        { status: 'ontime' },
        { status: 'ontime' },
        { status: 'late' },
        { status: 'missed' },
      ]}
    />,
  );
  expect(
    screen.getByRole('img', { name: '3 de 5 ventanas a tiempo, 1 tardía, 1 no realizada' }),
  ).toBeInTheDocument();
});

it('dibuja un casillero por ventana y el tamaño grilla los estira', () => {
  const { container } = render(
    <WindowBar size="grid" windows={[{ status: 'current' }, { status: 'pending' }]} />,
  );
  const boxes = container.querySelectorAll('[data-status]');
  expect(boxes).toHaveLength(2);
  expect(boxes[0]).toHaveClass('max-w-14', 'flex-1');
});
