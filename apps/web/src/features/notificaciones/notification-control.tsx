import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { activateNotifications } from './notifications';

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
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => void activate()}
        disabled={busy}
      >
        {busy ? 'Activando…' : 'Activar notificaciones'}
      </Button>
      {message && (
        <p role="status" className="text-xs text-sidebar-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
