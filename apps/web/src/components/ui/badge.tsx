import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';

// Sello Foja (estados con fondo *-soft tenue): rectángulo casi a escuadra, borde 1.5px en el color del texto, condensada tabular.
// Mapeo de variantes (nombres previos -> forma):
//   normal (tinta)   : default, secondary, outline, success, info   (success/info: confirmaciones puntuales)
//   tarde (ámbar)    : warning, tarde
//   falla (rojo)     : danger, destructive, falla
//   punteado         : neutral, punteado        (borde discontinuo, texto atenuado)
//   ahora (invertido): signal, ahora            (bg-primary text-primary-foreground)
const badgeVariants = cva(
  't-stamp group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border-[1.5px] border-current px-2 whitespace-nowrap transition-colors aria-invalid:border-danger has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        default: 'text-foreground [a]:hover:bg-muted',
        secondary: 'bg-muted text-foreground [a]:hover:bg-muted/70',
        outline: 'bg-card text-foreground [a]:hover:bg-muted',
        ghost: 'border-transparent text-foreground hover:bg-muted',
        link: 'border-transparent text-foreground underline underline-offset-4 hover:bg-muted',
        success: 'bg-success-soft text-success',
        info: 'bg-info-soft text-info',
        normal: 'text-foreground',
        warning: 'bg-warning-soft text-warning',
        tarde: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
        destructive: 'bg-danger-soft text-danger',
        falla: 'bg-danger-soft text-danger',
        neutral: 'border-dashed text-muted-foreground',
        punteado: 'border-dashed text-muted-foreground',
        signal: 'border-primary bg-primary text-primary-foreground',
        ahora: 'border-primary bg-primary text-primary-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
