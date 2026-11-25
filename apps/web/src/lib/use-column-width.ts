import { useState } from 'react';

/**
 * Ancho de la primera columna en %, recordado por navegador. Si el almacenamiento falla
 * (ventana privada, sitio bloqueado) arranca en `initial` y no se recuerda.
 */
export function useColumnWidth(storageKey: string, initial: number, min: number, max: number) {
  const clamp = (value: number) => Math.min(max, Math.max(min, value));
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      return saved ? clamp(saved) : initial;
    } catch {
      return initial;
    }
  });
  const save = (value: number) => {
    try {
      localStorage.setItem(storageKey, String(Math.round(value)));
    } catch {
      /* Sin almacenamiento: el ancho vale solo para esta visita. */
    }
  };
  const set = (value: number) => {
    setWidth(clamp(value));
  };
  return { width, min, max, set, save };
}
