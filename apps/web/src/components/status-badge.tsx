import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'signal' | 'neutral';

/**
 * Estado de un turno, ronda, usuario o registro: punto + texto. El color refuerza,
 * pero el texto siempre dice el estado (WCAG 1.4.1). Usar el mismo tono para el mismo
 * estado en todas las pantallas.
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
  return (
    <Badge variant={tone} className={cn('gap-1.5', className)}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </Badge>
  );
}
