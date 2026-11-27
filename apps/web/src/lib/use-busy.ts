import { useCallback, useRef, useState } from 'react';

/** Evita el doble envío: ignora nuevas ejecuciones mientras una está en curso y expone `busy` para deshabilitar el botón. */
export function useBusy() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (task: () => Promise<unknown>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await task();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}
