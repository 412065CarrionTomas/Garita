import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

/*
 * Arrastre con puntero (mouse, táctil o lápiz) sobre un asa: no sabe de grillas ni de listas,
 * solo informa cuánto se movió el puntero desde que empezó. Reglas:
 * - Solo el botón principal; el elemento captura el puntero, así el arrastre sigue aunque el
 *   puntero salga del asa.
 * - Con `holdMs`, el arrastre empieza después de mantener apretado sin moverse más de
 *   `tolerance` px (en táctil, moverse antes es desplazar la página, no arrastrar).
 * - Escape, `pointercancel` o perder la captura cancelan; soltar termina.
 * El asa necesita `touch-action: none` para que el navegador no desplace mientras se arrastra.
 */

export interface DragDelta {
  dx: number;
  dy: number;
}

export interface PointerDragOptions {
  /** Devolver false rechaza el arrastre (p. ej. hay otro gesto en curso): no se muestra ni captura. */
  onStart: () => unknown;
  onMove: (delta: DragDelta) => void;
  onEnd: () => void;
  onCancel: () => void;
  holdMs?: number;
  tolerance?: number;
}

interface Session {
  pointerId: number;
  element: HTMLElement;
  originX: number;
  originY: number;
  active: boolean;
  timer: number | undefined;
  detach: () => void;
}

export function usePointerDrag(options: PointerDragOptions): {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  dragging: boolean;
} {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const session = useRef<Session | null>(null);
  const [dragging, setDragging] = useState(false);

  const finish = useCallback((outcome: 'end' | 'cancel') => {
    const current = session.current;
    if (!current) return;
    session.current = null;
    window.clearTimeout(current.timer);
    current.detach();
    if (current.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
    if (!current.active) return;
    setDragging(false);
    if (outcome === 'end') latest.current.onEnd();
    else latest.current.onCancel();
  }, []);

  // Si el componente se desmonta a mitad de un arrastre, se cancela para no dejar el gesto abierto.
  useEffect(
    () => () => {
      finish('cancel');
    },
    [finish],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || session.current) return;
      event.preventDefault();
      const element = event.currentTarget;
      const { holdMs = 0, tolerance = 6 } = latest.current;
      const activate = () => {
        const current = session.current;
        // Sin sesión (se canceló) o ya activo: nada que hacer.
        if (current?.active !== false) return;
        if (latest.current.onStart() === false) {
          finish('cancel');
          return;
        }
        current.active = true;
        setDragging(true);
      };
      const onMove = (move: globalThis.PointerEvent) => {
        const current = session.current;
        if (current?.pointerId !== move.pointerId) return;
        const dx = move.clientX - current.originX;
        const dy = move.clientY - current.originY;
        if (!current.active) {
          // Moverse antes de completar la espera es otra intención (desplazar): se abandona.
          if (Math.hypot(dx, dy) > tolerance) finish('cancel');
          return;
        }
        latest.current.onMove({ dx, dy });
      };
      const onUp = (up: globalThis.PointerEvent) => {
        if (up.pointerId === session.current?.pointerId) finish('end');
      };
      const onCancel = () => {
        finish('cancel');
      };
      const onKey = (key: KeyboardEvent) => {
        if (key.key === 'Escape') {
          key.preventDefault();
          finish('cancel');
        }
      };
      element.addEventListener('pointermove', onMove);
      element.addEventListener('pointerup', onUp);
      element.addEventListener('pointercancel', onCancel);
      element.addEventListener('lostpointercapture', onCancel);
      window.addEventListener('keydown', onKey);
      session.current = {
        pointerId: event.pointerId,
        element,
        originX: event.clientX,
        originY: event.clientY,
        active: false,
        timer: holdMs > 0 ? window.setTimeout(activate, holdMs) : undefined,
        detach: () => {
          element.removeEventListener('pointermove', onMove);
          element.removeEventListener('pointerup', onUp);
          element.removeEventListener('pointercancel', onCancel);
          element.removeEventListener('lostpointercapture', onCancel);
          window.removeEventListener('keydown', onKey);
        },
      };
      element.setPointerCapture(event.pointerId);
      if (holdMs <= 0) activate();
    },
    [finish],
  );

  return { onPointerDown, dragging };
}
