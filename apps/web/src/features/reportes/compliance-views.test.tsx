import { screen, within } from '@testing-library/react';
import { emptyComplianceTotals } from '@garita/shared';
import { renderWithQueryClient } from '@/test/render';
import { SiteComplianceTable } from './compliance-views';

it('shows incomplete windows so the evaluated columns add up', () => {
  renderWithQueryClient(
    <SiteComplianceTable
      sites={[
        {
          id: 'site',
          name: 'Predio',
          totals: {
            ...emptyComplianceTotals(),
            complete: 4,
            complete_late: 1,
            incomplete: 2,
            not_done: 3,
            evaluated: 9,
          },
        },
      ]}
      onSelect={jest.fn()}
    />,
  );
  expect(screen.getByRole('columnheader', { name: 'Incompletas' })).toBeInTheDocument();
  const row = screen.getAllByRole('row')[1];
  if (!row) throw new Error('Missing row');
  const cells = within(row).getAllByRole('cell');
  expect(cells.slice(1, 6).map((cell) => Number(cell.textContent))).toEqual([9, 3, 1, 2, 3]);
});
