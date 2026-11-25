import { useState } from 'react';

export type NoticeTone = 'info' | 'danger';
export interface Notice {
  text: string;
  tone: NoticeTone;
  /** Cambia en cada aviso: como `key` de `FloatingNotice` reinicia su plazo aunque el texto se repita. */
  id: number;
}

/** Estado del aviso flotante de una pantalla: `notify` lo muestra, `close` lo saca. */
export function useFloatingNotice(initial?: { text: string; tone?: NoticeTone }) {
  const [notice, setNotice] = useState<Notice | undefined>(
    initial && { text: initial.text, tone: initial.tone ?? 'info', id: 1 },
  );
  const notify = (text: string, tone: NoticeTone = 'info') => {
    setNotice((prev) => ({ text, tone, id: (prev?.id ?? 0) + 1 }));
  };
  const close = () => {
    setNotice(undefined);
  };
  return { notice, notify, close };
}
