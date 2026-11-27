import { StrictMode } from 'react';
import { act, render } from '@testing-library/react';
import { targetIndex, useSortableDrag, type SortableDrag } from './use-sortable-drag';

it('el destino cambia a mitad de cada fila y no se sale de la lista', () => {
  expect(targetIndex(1, 23, 48, 4)).toBe(1);
  expect(targetIndex(1, 25, 48, 4)).toBe(2);
  expect(targetIndex(1, -30, 48, 4)).toBe(0);
  expect(targetIndex(1, 500, 48, 4)).toBe(3);
  expect(targetIndex(2, -500, 48, 4)).toBe(0);
});

function setup(onReorder: jest.Mock) {
  let api: SortableDrag | undefined;
  function Probe() {
    api = useSortableDrag(['a', 'b', 'c', 'd'], onReorder);
    return null;
  }
  // StrictMode ejecuta dos veces lo que React puede repetir: soltar debe informar una sola vez.
  render(
    <StrictMode>
      <Probe />
    </StrictMode>,
  );
  return () => {
    if (!api) throw new Error('sin hook');
    return api;
  };
}

it('mientras arrastra corre a las filas del camino y al soltar informa una sola vez', () => {
  const onReorder = jest.fn();
  const drag = setup(onReorder);
  act(() => {
    drag().start('a', 48);
  });
  act(() => {
    drag().move(100);
  });
  expect(drag().draggingId).toBe('a');
  expect(drag().rowStyle('a')?.transform).toBe('translateY(100px)');
  expect(drag().rowStyle('b')?.transform).toBe('translateY(-48px)');
  expect(drag().rowStyle('c')?.transform).toBe('translateY(-48px)');
  expect(drag().rowStyle('d')).toBeUndefined();
  act(() => {
    drag().end();
  });
  expect(onReorder).toHaveBeenCalledTimes(1);
  expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a', 'd'], 'a', 2);
  expect(drag().draggingId).toBeNull();
});

it('cancelar o soltar en el mismo lugar no informa nada', () => {
  const onReorder = jest.fn();
  const drag = setup(onReorder);
  act(() => {
    drag().start('c', 48);
  });
  act(() => {
    drag().move(-60);
  });
  expect(drag().rowStyle('b')?.transform).toBe('translateY(48px)');
  act(() => {
    drag().cancel();
  });
  act(() => {
    drag().start('c', 48);
  });
  act(() => {
    drag().move(10);
  });
  act(() => {
    drag().end();
  });
  expect(onReorder).not.toHaveBeenCalled();
});
