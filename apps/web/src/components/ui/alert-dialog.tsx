import { cn } from 'cn';
import { AlertDialog as Primitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export const AlertDialog = Primitive.Root;
export const AlertDialogTrigger = Primitive.Trigger;
export const AlertDialogCancel = Primitive.Cancel;
export const AlertDialogAction = Primitive.Action;
export function AlertDialogTitle({ className, ...props }: ComponentProps<typeof Primitive.Title>) {
  return (
    <Primitive.Title
      className={cn(
        'font-cond text-xl font-semibold tracking-wider text-foreground uppercase',
        className,
      )}
      {...props}
    />
  );
}
export function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof Primitive.Description>) {
  return (
    <Primitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />
  );
}
// Foja: hoja con borde de 2px en tinta, sin sombra, sobre un velo oscuro liso.
export function AlertDialogContent({
  className,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-40 bg-bar/70 duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <Primitive.Content
        {...props}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 w-[min(32.5rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 border-primary bg-popover p-6 text-popover-foreground duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className,
        )}
      />
    </Primitive.Portal>
  );
}
