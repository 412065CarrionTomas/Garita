import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Siren } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import type { z } from 'zod';
import type { panicAlertSummarySchema } from '@garita/shared';

/** Un pitido de medio segundo, si el navegador ya habilitó el audio. */
function beep(audio: AudioContext | null) {
  if (audio?.state !== 'running') return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.12, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.5);
  oscillator.start();
  oscillator.stop(audio.currentTime + 0.5);
}

export function PanicBanner({
  alerts,
  count,
}: {
  alerts: z.infer<typeof panicAlertSummarySchema>[];
  count: number;
}) {
  const context = useRef<AudioContext | null>(null);
  const active = count > 0;
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
    if (!active) return;
    beep(context.current);
    const timer = window.setInterval(() => {
      beep(context.current);
    }, 4000);
    return () => {
      window.clearInterval(timer);
    };
  }, [active]);
  // El navegador solo deja sonar después de un gesto: el primer clic o tecla en la app habilita el audio.
  useEffect(() => {
    const stop = () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
    function unlock() {
      try {
        context.current ??= new AudioContext();
      } catch {
        // Sin audio en este navegador: queda el aviso visual.
        stop();
        return;
      }
      const audio = context.current;
      audio
        .resume()
        .then(() => {
          if (audio.state !== 'running') return;
          // Ya habilitado: no hace falta escuchar más gestos, y si hay alerta suena ya.
          stop();
          if (activeRef.current) beep(audio);
        })
        // Algunos gestos (como Tab o Escape) no cuentan: se espera el próximo.
        .catch(() => undefined);
    }
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    return () => {
      stop();
      const audio = context.current;
      context.current = null;
      audio?.close().catch(() => undefined);
    };
  }, []);
  const first = alerts[0];
  return (
    <>
      {active && (
        <Alert role="alert" aria-live="assertive" aria-atomic="true" variant="destructive">
          <Siren aria-hidden="true" />
          <div className="space-y-2">
            <p className="t-headline">
              Alerta de pánico · {count} {count === 1 ? 'activa' : 'activas'}
            </p>
            <p>
              {first?.site.name ?? 'Hay una emergencia pendiente de confirmar'}. Confirmá la
              recepción para detener el sonido.
            </p>
            <Link
              className="font-semibold underline underline-offset-4"
              to={first ? `/alertas-panico/${first.id}` : '/alertas-panico'}
            >
              Atender alerta
            </Link>
          </div>
        </Alert>
      )}
    </>
  );
}
