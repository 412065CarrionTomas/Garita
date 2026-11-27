import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SchedulePicker } from './schedule-picker';

const schedule = { frequency: 120, start: '22:00', end: '06:00', grace: 15 };

it('se cierra al tocar fuera del cuadro y no al tocar adentro', async () => {
  const user = userEvent.setup();
  render(
    <>
      <SchedulePicker schedule={schedule} errors={{}} onChange={jest.fn()} />
      <button type="button">Afuera</button>
    </>,
  );
  const details = screen.getByText('Horario de la ronda').closest('details');
  await user.click(screen.getByText('Horario de la ronda'));
  expect(details).toHaveAttribute('open');
  await user.click(screen.getByLabelText('Gracia (minutos)'));
  expect(details).toHaveAttribute('open');
  await user.click(screen.getByRole('button', { name: 'Afuera' }));
  expect(details).not.toHaveAttribute('open');
});
