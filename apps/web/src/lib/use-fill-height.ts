import { useLayoutEffect, useState } from 'react';

/**
 * Alto que le queda al elemento hasta el borde inferior de la ventana, para que un mapa o una tabla
 * llenen la pantalla sin hacer bajar la página. Se recalcula al montarse el elemento y al cambiar
 * el tamaño de la ventana. `measure` va en `ref`: sirve aunque el elemento aparezca después.
 */
export function useFillHeight<T extends HTMLElement>(gap = 8, min = 320) {
  const [element, measure] = useState<T | null>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    if (!element) return;
    const update = () => {
      // Oculto (por ejemplo, en una pestaña inactiva) no tiene posición: se mide al aparecer.
      if (element.getClientRects().length === 0) return;
      const top = element.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(min, window.innerHeight - top - gap));
    };
    update();
    window.addEventListener('resize', update);
    // Lo de arriba puede crecer o achicarse (pestañas, avisos): se vuelve a medir con la página.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(document.body);
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [element, gap, min]);
  return [measure, height] as const;
}
