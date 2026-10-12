import { AlertDialog as Primitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export const AlertDialog = Primitive.Root;
export const AlertDialogTrigger = Primitive.Trigger;
export const AlertDialogCancel = Primitive.Cancel;
export const AlertDialogAction = Primitive.Action;
export const AlertDialogTitle = Primitive.Title;
export const AlertDialogDescription = Primitive.Description;
export function AlertDialogContent(props: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-40 bg-black/50" />
      <Primitive.Content
        {...props}
        className={`fixed left-1/2 top-1/2 z-50 w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg ${props.className ?? ''}`}
      />
    </Primitive.Portal>
  );
}
