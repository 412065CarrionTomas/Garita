import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Siren } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import type { z } from 'zod';
import type { panicAlertSummarySchema } from '@garita/shared';

export function PanicBanner({
  alerts,
  count,
}: {
  alerts: z.infer<typeof panicAlertSummarySchema>[];
  count: number;
}) {
  const context = useRef<AudioContext | null>(null);
  const active = count > 0;
  useEffect(() => {
    if (!active) return;
    const tone = () => {
      const audio = context.current;
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
    };
    tone();
    const timer = window.setInterval(tone, 4000);
    return () => {
      window.clearInterval(timer);
    };
  }, [active]);
  // El navegador solo deja sonar después de un gesto: el primer clic o tecla en la app habilita el audio.
  useEffect(() => {
    const unlock = () => {
      try {
        context.current ??= new AudioContext();
        void context.current.resume();
      } catch {
        /* Sin audio en este navegador: queda el aviso visual. */
      }
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      const audio = context.current;
      context.current = null;
      void audio?.close();
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
