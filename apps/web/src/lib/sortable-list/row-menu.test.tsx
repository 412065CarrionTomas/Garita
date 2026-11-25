import { act, fireEvent, render, screen } from '@testing-library/react';
import { RowMenu } from './row-menu';

const groups = [{ actions: [{ key: 'pin', label: 'Fijar arriba', onSelect: jest.fn() }] }];
const drag = { onStart: jest.fn(), onMove: jest.fn(), onEnd: jest.fn(), onCancel: jest.fn() };

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

/** Mantiene apretado el botón hasta que empieza el arrastre. */
function startDrag(button: HTMLElement) {
  fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  act(() => {
    jest.advanceTimersByTime(300);
  });
  expect(drag.onStart).toHaveBeenCalled();
}

it('un arrastre cancelado no se traga el clic siguiente', () => {
  render(<RowMenu label="Predio Norte" groups={groups} drag={drag} />);
  const button = screen.getByRole('button', { name: 'Acciones de Predio Norte' });
  startDrag(button);
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(button);
  expect(screen.getByRole('menuitem', { name: 'Fijar arriba' })).toBeInTheDocument();
});

it('soltar sin clic encima tampoco deja la marca de arrastre puesta', () => {
  render(<RowMenu label="Predio Norte" groups={groups} drag={drag} />);
  const button = screen.getByRole('button', { name: 'Acciones de Predio Norte' });
  startDrag(button);
  fireEvent.pointerUp(button, { pointerId: 1 });
  act(() => {
    jest.runOnlyPendingTimers();
  });
  fireEvent.click(button);
  expect(screen.getByRole('menuitem', { name: 'Fijar arriba' })).toBeInTheDocument();
});
