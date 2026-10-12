import { Dialog as Primitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;
export function DialogContent(props: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-40 bg-black/50" />
      <Primitive.Content
        {...props}
        className={`fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(42rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border bg-background p-6 shadow-lg ${props.className ?? ''}`}
      />
    </Primitive.Portal>
  );
}
