import { render } from '@testing-library/react';
import { useRef } from 'react';
import { useFlipAnimation } from './use-flip-animation';

/** Dos cajas cuya posición vertical sale de `tops`; `skip` marca una para no animarla. */
function Boxes({ tops, skip }: { tops: Record<string, number>; skip?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useFlipAnimation(ref, true, [tops]);
  return (
    <div ref={ref}>
      {Object.entries(tops).map(([id, top]) => (
        <div
          key={id}
          data-flip-id={id}
          data-top={top}
          data-flip-skip={id === skip ? '' : undefined}
        />
      ))}
    </div>
  );
}

const animate = jest.fn<Animation, [Keyframe[], KeyframeAnimationOptions]>();

beforeEach(() => {
  animate.mockReset();
  Object.assign(HTMLElement.prototype, { animate, getAnimations: () => [] });
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = Number(this.dataset.top ?? 0);
    return { left: 0, top, width: 10, height: 10 } as DOMRect;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations');
});

it('desliza desde el lugar viejo solo a los que cambiaron de lugar', () => {
  const { rerender } = render(<Boxes tops={{ a: 0, b: 100 }} />);
  expect(animate).not.toHaveBeenCalled();
  rerender(<Boxes tops={{ a: 0, b: 40 }} />);
  expect(animate).toHaveBeenCalledTimes(1);
  expect(animate.mock.calls[0]?.[0]).toEqual([
    { transform: 'translate(0px, 60px)' },
    { transform: 'translate(0, 0)' },
  ]);
});

it('no anima al que sigue al puntero', () => {
  const { rerender } = render(<Boxes tops={{ a: 0, b: 100 }} skip="b" />);
  rerender(<Boxes tops={{ a: 0, b: 40 }} skip="b" />);
  expect(animate).not.toHaveBeenCalled();
});

it('respeta el pedido de movimiento reducido', () => {
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });
  const { rerender } = render(<Boxes tops={{ a: 0, b: 100 }} />);
  rerender(<Boxes tops={{ a: 0, b: 40 }} />);
  expect(animate).not.toHaveBeenCalled();
  Reflect.deleteProperty(window, 'matchMedia');
});
