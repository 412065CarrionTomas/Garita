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

it('vuelve a medir cuando aparece un aviso nuevo arriba dentro de main', async () => {
  window.ResizeObserver = jest.fn(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));
  const rects = jest
    .spyOn(HTMLElement.prototype, 'getClientRects')
    .mockImplementation(() => [{}] as unknown as DOMRectList);
  let top = 100;
  const box = jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(() => ({ top }) as DOMRect);
  const main = document.createElement('main');
  document.body.append(main);
  const { getByTestId } = render(<Filler />, { container: main });
  const element = getByTestId('fill');
  const before = Number(element.getAttribute('data-height'));
  // Un banner entra a `main` y empuja el elemento 60 px.
  top = 160;
  await act(async () => {
    main.prepend(document.createElement('div'));
    await Promise.resolve();
  });
  expect(Number(element.getAttribute('data-height'))).toBe(before - 60);
  rects.mockRestore();
  box.mockRestore();
  main.remove();
});
