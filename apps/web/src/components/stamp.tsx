import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export type StampVariant = 'normal' | 'late' | 'fail' | 'dashed' | 'now';

const variants: Record<StampVariant, string> = {
  normal: 'text-foreground',
  late: 'text-warning',
  // Doble contorno + inclinación: la falla se distingue sin color.
  fail: 'm-1 -rotate-2 text-danger outline outline-1 outline-offset-2 outline-danger',
  dashed: 'border-dashed text-muted-foreground',
  now: 'border-primary bg-primary text-primary-foreground',
};

/**
 * Sello de hora o de estado: recuadro de 1,5 px en condensada. La variante cambia la forma
 * (punteado, invertido, doble contorno) además del color. `check` agrega la tilde de "registrado".
 */
export function Stamp({
  variant = 'normal',
  check = false,
  children,
  className,
  ...props
}: {
  variant?: StampVariant;
  check?: boolean;
} & ComponentProps<'span'>) {
  return (
    <span
      data-slot="stamp"
      data-variant={variant}
      className={cn(
        't-stamp inline-flex items-center gap-1.5 whitespace-nowrap border-[1.5px] border-current px-2 py-0.5',
        variants[variant],
        className,
      )}
      {...props}
    >
      {check && (
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="size-3.5 fill-none stroke-current"
          strokeWidth="2.6"
        >
          <path d="M3 8.5l3.5 3.5L13 4.5" />
        </svg>
      )}
      {children}
    </span>
  );
}
