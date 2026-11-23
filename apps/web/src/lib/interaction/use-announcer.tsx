import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

/**
 * Región `aria-live` propia de un componente, para anunciar lo que pasa al mover o reordenar
 * algo con el teclado (WCAG 4.1.3). Cada consumidor dibuja su `region`; no hay estado global.
 * Un mensaje igual al anterior se vuelve a anunciar: se vacía la región y se escribe de nuevo.
 */
export function useAnnouncer(): { announce: (message: string) => void; region: ReactElement } {
  const [message, setMessage] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );
  const announce = useCallback((next: string) => {
    window.clearTimeout(timer.current);
    setMessage('');
    // Un tick después, para que el lector registre el cambio aunque el texto se repita.
    timer.current = window.setTimeout(() => {
      setMessage(next);
    }, 50);
  }, []);
  const region = (
    <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="announcer">
      {message}
    </div>
  );
  return { announce, region };
}
