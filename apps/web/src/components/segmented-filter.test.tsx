import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SegmentedFilter } from './segmented-filter';

const options = [
  { value: 'a', label: 'Tabla' },
  { value: 'b', label: 'Grilla' },
];

it('marca con aria-pressed la opción activa y avisa el cambio', async () => {
  const onChange = jest.fn();
  render(<SegmentedFilter ariaLabel="Vista" options={options} value="a" onChange={onChange} />);

  expect(screen.getByRole('group', { name: 'Vista' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tabla' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Grilla' })).toHaveAttribute('aria-pressed', 'false');

  await userEvent.click(screen.getByRole('button', { name: 'Grilla' }));
  expect(onChange).toHaveBeenCalledWith('b');
});
