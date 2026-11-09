import { useState } from 'react';
import { BellIcon } from 'lucide-react';

import { activateNotifications } from './notifications';

/** Botón de la barra para activar notificaciones; el resultado aparece como aviso bajo la barra. */
export function NotificationControl() {
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
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void activate()}
        disabled={busy}
        className="flex h-9 items-center gap-2 rounded-md border-[1.5px] border-bar-muted px-2.5 text-xs font-semibold text-bar-foreground outline-none hover:bg-bar-foreground/10 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-bar-foreground disabled:opacity-60"
      >
        <BellIcon className="size-4" aria-hidden="true" />
        {busy ? 'Activando…' : 'Activar notificaciones'}
      </button>
      {message && (
        <p
          role="status"
          className="absolute top-full right-0 z-30 mt-2 w-64 rounded-md border-2 border-primary bg-card p-3 text-xs text-card-foreground"
        >
          {message}
        </p>
      )}
    </div>
  );
}
