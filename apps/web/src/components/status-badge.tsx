import { Stamp, type StampVariant } from '@/components/stamp';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'signal' | 'neutral';

// Lo normal va en tinta; ámbar = demora; rojo = falla; punteado = sin dato o interno; invertido = en curso.
const TONE_STAMP: Record<StatusTone, { variant: StampVariant; check?: boolean }> = {
  success: { variant: 'normal', check: true },
  info: { variant: 'normal' },
  warning: { variant: 'late' },
  danger: { variant: 'fail' },
  signal: { variant: 'now' },
  neutral: { variant: 'dashed' },
};

/**
 * Estado de un turno, ronda, usuario o registro como sello: la forma (tilde, punteado, doble
 * contorno, invertido) y el texto dicen el estado, no solo el color (WCAG 1.4.1). Usar el mismo
 * tono para el mismo estado en todas las pantallas.
 */
export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: string;
  className?: string;
}) {
  const { variant, check } = TONE_STAMP[tone];
  return (
    <Stamp data-slot="badge" variant={variant} check={check} className={className}>
      {children}
    </Stamp>
  );
}
