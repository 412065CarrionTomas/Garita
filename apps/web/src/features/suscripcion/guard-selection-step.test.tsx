import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GuardSelection } from '@garita/shared';
import { GuardSelectionStep } from './guard-selection-step';

it('chooses who stays using the keyboard and offers derivation only to retained guards', async () => {
  const required = {
    code: 'guard_selection_required' as const,
    maxGuards: 1,
    guards: [
      { id: 'a', name: 'Ana', futureShiftCount: 2 },
      { id: 'b', name: 'Bruno', futureShiftCount: 1 },
    ],
  };
  function Form() {
    const [value, setValue] = useState<GuardSelection>({
      guardsToKeep: [],
      shiftDecisions: required.guards.map((g) => ({
        guardId: g.id,
        shiftAction: 'unassign',
        confirmUnassignedCount: g.futureShiftCount,
      })),
    });
    return <GuardSelectionStep required={required} value={value} onChange={setValue} />;
  }
  render(<Form />);
  await userEvent.tab();
  expect(screen.getByRole('checkbox', { name: 'Ana' })).toHaveFocus();
  await userEvent.keyboard(' ');
  expect(screen.getByRole('status')).toHaveTextContent('1 de 1');
  expect(screen.getByRole('checkbox', { name: 'Bruno' })).toBeDisabled();
  expect(screen.getByRole('option', { name: 'Derivar sus turnos a Ana' })).toBeInTheDocument();
  await userEvent.tab();
  expect(screen.getByRole('combobox')).toHaveFocus();
  await userEvent.selectOptions(screen.getByRole('combobox'), 'a');
  expect(screen.getByRole('combobox')).toHaveValue('a');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Ana' }));
  expect(
    screen.queryByRole('option', { name: 'Derivar sus turnos a Ana' }),
  ).not.toBeInTheDocument();
});
