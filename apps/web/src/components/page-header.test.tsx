import { render, screen } from '@testing-library/react';

import { PageHeader } from './page-header';

it('muestra el título como h1, la descripción y las acciones', () => {
  render(
    <PageHeader
      id="t"
      title="Turnos"
      description="Todos los turnos"
      actions={<button>Nuevo</button>}
    />,
  );
  expect(screen.getByRole('heading', { level: 1, name: 'Turnos' })).toHaveAttribute('id', 't');
  expect(screen.getByText('Todos los turnos')).toHaveClass('text-muted-foreground');
  expect(screen.getByRole('button', { name: 'Nuevo' })).toBeInTheDocument();
});
