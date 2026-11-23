import { useLayoutEffect, useRef, type DependencyList, type RefObject } from 'react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * Anima con la técnica FLIP los hijos de `container` que cambian de lugar entre renders: mide
 * dónde estaba cada uno, dónde quedó, y lo desliza desde el lugar viejo. No sabe de grillas: los
 * hijos se identifican con el atributo `data-flip-id` y no se anima el que tenga, él o adentro,
 * `data-flip-skip` (p. ej. el bloque que sigue al puntero). Las posiciones son relativas al contenedor, así
 * desplazar la página no anima nada. Sin animación si el usuario pide movimiento reducido o el
 * navegador no tiene Web Animations (tests).
 */
export function useFlipAnimation(
  container: RefObject<HTMLElement | null>,
  enabled: boolean,
  deps: DependencyList,
  { duration = 180 }: { duration?: number } = {},
): void {
  const previous = useRef(new Map<string, { left: number; top: number }>());
  useLayoutEffect(() => {
    const root = container.current;
    if (!root || !enabled) {
      previous.current.clear();
      return;
    }
    const reduce =
      typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;
    const origin = root.getBoundingClientRect();
    const next = new Map<string, { left: number; top: number }>();
    for (const node of root.querySelectorAll<HTMLElement>('[data-flip-id]')) {
      const id = node.dataset.flipId;
      if (!id || typeof node.animate !== 'function') continue;
      // Se mide sin la animación anterior, si quedaba una en curso: la posición final real.
      for (const running of node.getAnimations()) running.cancel();
      const rect = node.getBoundingClientRect();
      const place = { left: rect.left - origin.left, top: rect.top - origin.top };
      next.set(id, place);
      const before = previous.current.get(id);
      if (
        !before ||
        reduce ||
        node.matches('[data-flip-skip]') ||
        node.querySelector('[data-flip-skip]')
      )
        continue;
      const dx = before.left - place.left;
      const dy = before.top - place.top;
      if (dx === 0 && dy === 0) continue;
      node.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
    }
    previous.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- las dependencias las da quien lo usa.
  }, [enabled, ...deps]);
}
