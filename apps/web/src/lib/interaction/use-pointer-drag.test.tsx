import { act, fireEvent, render, screen } from '@testing-library/react';
import { usePointerDrag, type PointerDragOptions } from './use-pointer-drag';

function Handle(props: Partial<PointerDragOptions>) {
  const options: PointerDragOptions = {
    onStart: jest.fn(),
    onMove: jest.fn(),
    onEnd: jest.fn(),
    onCancel: jest.fn(),
    ...props,
  };
  const { onPointerDown, dragging } = usePointerDrag(options);
  return (
    <button type="button" onPointerDown={onPointerDown}>
      {dragging ? 'arrastrando' : 'quieto'}
    </button>
  );
}

function setup(props: Partial<PointerDragOptions> = {}) {
  const callbacks = {
    onStart: jest.fn(),
    onMove: jest.fn(),
    onEnd: jest.fn(),
    onCancel: jest.fn(),
    ...props,
  };
  render(<Handle {...callbacks} />);
  return { handle: screen.getByRole('button'), ...callbacks };
}
const down = (el: Element, x = 10, y = 10) =>
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: x, clientY: y });
const move = (el: Element, x: number, y: number) =>
  fireEvent.pointerMove(el, { pointerId: 1, clientX: x, clientY: y });

it('informa el desplazamiento desde el inicio y termina al soltar', () => {
  const { handle, onStart, onMove, onEnd, onCancel } = setup();
  down(handle);
  expect(onStart).toHaveBeenCalledTimes(1);
  expect(handle).toHaveTextContent('arrastrando');
  move(handle, 40, 25);
  expect(onMove).toHaveBeenLastCalledWith({ dx: 30, dy: 15 });
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();
  expect(handle).toHaveTextContent('quieto');
});

it('Escape cancela el arrastre', () => {
  const { handle, onCancel, onEnd } = setup();
  down(handle);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledTimes(1);
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(onEnd).not.toHaveBeenCalled();
});

it('ignora botones que no son el principal', () => {
  const { handle, onStart } = setup();
  fireEvent.pointerDown(handle, { button: 2, pointerId: 1 });
  expect(onStart).not.toHaveBeenCalled();
});

describe('mantener apretado', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('empieza recién después de la espera', () => {
    const { handle, onStart, onMove } = setup({ holdMs: 300 });
    down(handle);
    expect(onStart).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onStart).toHaveBeenCalledTimes(1);
    move(handle, 10, 60);
    expect(onMove).toHaveBeenLastCalledWith({ dx: 0, dy: 50 });
  });

  it('moverse antes de la espera es desplazar: no arrastra', () => {
    const { handle, onStart, onCancel } = setup({ holdMs: 300, tolerance: 6 });
    down(handle);
    move(handle, 10, 30);
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onStart).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

it('si onStart rechaza el arrastre no se muestra ni avisa el final', () => {
  const { handle, onMove, onEnd, onCancel } = setup({ onStart: jest.fn(() => false) });
  down(handle);
  expect(handle).toHaveTextContent('quieto');
  move(handle, 40, 25);
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(onMove).not.toHaveBeenCalled();
  expect(onEnd).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
});
