import { X } from 'lucide-react';
import { useEffect, useEffectEvent, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export const NOTICE_MS = 10_000;

/**
 * Aviso flotante abajo a la derecha: se cierra solo a los 10 s o con la X. Con el mouse o el foco
 * encima no se cierra (un aviso largo se puede terminar de leer); al salir, el plazo vuelve a empezar.
 * Para repetir el mismo aviso, montarlo con otra `key` (así el plazo vuelve a empezar).
 */
export function FloatingNotice({
  text,
  tone = 'info',
  onClose,
}: {
  text: string;
  tone?: 'info' | 'danger';
  onClose: () => void;
}) {
  // El plazo corre desde que aparece, aunque quien lo usa cree `onClose` en cada render.
  const close = useEffectEvent(onClose);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => {
      close();
    }, NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [paused]);
  return (
    <Alert
      role={tone === 'danger' ? 'alert' : 'status'}
      variant={tone === 'danger' ? 'destructive' : 'default'}
      className="fixed right-4 bottom-4 z-50 w-auto max-w-sm pr-11 shadow-lg"
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <p>{text}</p>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Cerrar aviso"
        className="absolute top-1.5 right-1.5 text-current"
        onClick={onClose}
      >
        <X />
      </Button>
    </Alert>
  );
}
