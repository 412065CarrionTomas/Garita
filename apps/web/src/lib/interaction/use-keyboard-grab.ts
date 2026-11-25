import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export type Arrow = 'up' | 'down' | 'left' | 'right';

const ARROWS: Readonly<Record<string, Arrow>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export interface KeyboardGrabOptions {
  /** Devuelve false si no se puede tomar ahora (p. ej. hay un arrastre con el puntero). */
  onGrab: () => boolean;
  onStep: (arrow: Arrow) => void;
  onDrop: () => void;
  onCancel: () => void;
  /** Flechas que se atienden; las demás siguen su curso (p. ej. solo arriba y abajo en listas). */
  arrows?: readonly Arrow[];
}

/**
 * "Tomar y soltar" con el teclado sobre un asa (patrón de arrastre accesible): Enter o Espacio
 * toma, las flechas mueven, Enter o Espacio sueltan y Escape cancela. Si el asa pierde el foco
 * con algo tomado, se suelta (no queda un gesto abierto).
 */
export function useKeyboardGrab(options: KeyboardGrabOptions): {
  grabbed: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onBlur: () => void;
} {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const [grabbed, setGrabbed] = useState(false);
  const grabbedRef = useRef(false);
  const set = (value: boolean) => {
    grabbedRef.current = value;
    setGrabbed(value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const { key } = event;
    const toggle = key === 'Enter' || key === ' ';
    if (!grabbedRef.current) {
      if (!toggle) return;
      event.preventDefault();
      if (latest.current.onGrab()) set(true);
      return;
    }
    const arrow = ARROWS[key];
    if (arrow && (latest.current.arrows ?? Object.values(ARROWS)).includes(arrow)) {
      event.preventDefault();
      latest.current.onStep(arrow);
    } else if (toggle) {
      event.preventDefault();
      set(false);
      latest.current.onDrop();
    } else if (key === 'Escape') {
      event.preventDefault();
      set(false);
      latest.current.onCancel();
    }
  };

  // Desmontarse con algo tomado (bloque oculto, ventana angosta) cancela: no queda un gesto abierto.
  useEffect(
    () => () => {
      if (grabbedRef.current) latest.current.onCancel();
    },
    [],
  );

  const onBlur = () => {
    if (!grabbedRef.current) return;
    set(false);
    latest.current.onDrop();
  };

  return { grabbed, onKeyDown, onBlur };
}
