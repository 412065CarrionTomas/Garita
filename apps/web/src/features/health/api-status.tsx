import { cn } from '@/lib/utils';

import { useApiHealth } from './use-api-health';

const STATUS = {
  pending: { label: 'Verificando conexión…', dot: 'bg-muted-foreground' },
  success: { label: 'API conectada', dot: 'bg-emerald-500' },
  error: { label: 'API sin conexión', dot: 'bg-destructive' },
} as const;

/** Indicador del estado de conexión con la API. */
export function ApiStatus() {
  const { status } = useApiHealth();
  const { label, dot } = STATUS[status];

  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className={cn('size-2 rounded-full', dot)} aria-hidden="true" />
      {label}
    </p>
  );
}
