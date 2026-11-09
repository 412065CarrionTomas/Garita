import { render, screen } from '@testing-library/react';

import { EmptyState } from './empty-state';

it('muestra título, línea de recuperación y acción', () => {
  render(
    <EmptyState
      title="Sin turnos"
      description="Creá un turno nuevo."
      action={<button>Nuevo</button>}
    />,
  );
  expect(screen.getByText('Sin turnos')).toBeInTheDocument();
  expect(screen.getByText('Creá un turno nuevo.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Nuevo' })).toBeInTheDocument();
});
