import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Siren } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { z } from 'zod';
import type { panicAlertSummarySchema } from '@garita/shared';

const soundKey = 'garita-panic-sound';
function rememberedSound() {
  try {
    return localStorage.getItem(soundKey) === 'enabled';
  } catch {
    return false;
  }
}

export function PanicBanner({
  alerts,
  count,
}: {
  alerts: z.infer<typeof panicAlertSummarySchema>[];
  count: number;
}) {
  const context = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(rememberedSound);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const active = count > 0;
  useEffect(() => {
    if (!enabled || !active) return;
    let audio: AudioContext;
    try {
      audio = context.current ?? new AudioContext();
      context.current = audio;
    } catch {
      return;
    }
    const tone = () => {
      if (audio.state !== 'running') {
        setBlocked(true);
        return;
      }
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
    return () => window.clearInterval(timer);
  }, [enabled, active]);
  useEffect(
    () => () => {
      void context.current?.close();
    },
    [],
  );

  const enable = async () => {
    try {
      context.current ??= new AudioContext();
      await context.current.resume();
      if (context.current.state !== 'running') throw new Error('Audio bloqueado');
      try {
        localStorage.setItem(soundKey, 'enabled');
      } catch {
        /* The current session can still use sound. */
      }
      setEnabled(true);
      setBlocked(false);
      setError('');
    } catch {
      setError('No se pudo activar el sonido. Revisá los permisos del navegador.');
    }
  };
  const first = alerts[0];
  return (
    <>
      {(!enabled || blocked) && (
        <Button
          variant="outline"
          onClick={() => {
            void enable();
          }}
        >
          Activar sonido de alertas
        </Button>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      {active && (
        <Alert
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          className="border-danger bg-danger-soft text-danger"
        >
          <Siren aria-hidden="true" />
          <div className="space-y-2">
            <p className="font-semibold">
              Alerta de pánico · {count} {count === 1 ? 'activa' : 'activas'}
            </p>
            <p>
              {first?.site.name ?? 'Hay una emergencia pendiente de confirmar'}. Confirmá la
              recepción para detener el sonido.
            </p>
            <Link
              className="underline"
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
