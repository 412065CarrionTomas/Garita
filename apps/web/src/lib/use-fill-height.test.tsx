import { act, render } from '@testing-library/react';
import { useFillHeight } from './use-fill-height';

function Filler() {
  const [measure, height] = useFillHeight<HTMLDivElement>();
  return <div ref={measure} data-testid="fill" data-height={height ?? 'none'} />;
}

it('mide el elemento cuando su pestaña se muestra, aunque la página no cambie de tamaño', () => {
  const observed: Element[] = [];
  const observers: ResizeObserverCallback[] = [];
  window.ResizeObserver = jest.fn((callback: ResizeObserverCallback) => {
    observers.push(callback);
    return {
      observe: (target: Element) => observed.push(target),
      unobserve: jest.fn(),
      disconnect: jest.fn(),
    };
  });
  let visible = false;
  const rects = jest
    .spyOn(HTMLElement.prototype, 'getClientRects')
    .mockImplementation(() => (visible ? [{}] : []) as unknown as DOMRectList);
  const { getByTestId } = render(<Filler />);
  const element = getByTestId('fill');
  // Oculto: todavía no se puede medir.
  expect(element).toHaveAttribute('data-height', 'none');
  expect(observed).toContain(element);
  visible = true;
  act(() => {
    for (const callback of observers) callback([], {} as ResizeObserver);
  });
  expect(element).not.toHaveAttribute('data-height', 'none');
  rects.mockRestore();
});
