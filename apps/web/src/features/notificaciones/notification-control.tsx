import { useState } from 'react';
import { BellIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { activateNotifications, notificationsEnabled } from './notifications';

/**
 * Botón para activar notificaciones. Solo se muestra mientras falten en este dispositivo: sin ellas
 * no llega un pánico fuera del panel, así que el pedido no se esconde dentro de un menú. En la
 * barra va solo la campana; en el panel lateral lleva texto y el aviso abre hacia arriba.
 */
export function NotificationControl({ variant = 'bar' }: { variant?: 'bar' | 'sheet' }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function activate() {
    setBusy(true);
    setMessage('');
    try {
      setMessage(await activateNotifications());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No pudimos activar las notificaciones');
    } finally {
      setBusy(false);
    }
  }
  const label = busy ? 'Activando…' : 'Activar notificaciones';
  const enabled = notificationsEnabled();
  if (enabled && !message) return null;
  return (
    <div className="relative shrink-0">
      {!enabled && (
        <button
          type="button"
          aria-label={label}
          title={label}
          onClick={() => void activate()}
          disabled={busy}
          className={cn(
            'flex items-center gap-2 rounded-md border-[1.5px] border-bar-muted px-2.5 text-xs font-semibold text-bar-foreground outline-none hover:bg-bar-foreground/10 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-bar-foreground disabled:opacity-60',
            variant === 'sheet' ? 'h-11' : 'size-9 justify-center px-0',
          )}
        >
          <BellIcon className="size-4" aria-hidden="true" />
          {variant === 'sheet' && label}
        </button>
      )}
      {message && (
        <div
          className={cn(
            'absolute z-30 w-64 rounded-md border-2 border-primary bg-card p-3 text-xs text-card-foreground',
            variant === 'sheet' ? 'bottom-full left-0 mb-2' : 'top-full right-0 mt-2',
          )}
        >
          <p role="status">{message}</p>
          <button
            type="button"
            className="mt-2 font-semibold underline"
            onClick={() => {
              setMessage('');
            }}
          >
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
}
