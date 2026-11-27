import { useRef, useState, type SyntheticEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { commentSchema, detailSchema, type Detail } from './review-contracts';

export interface ReviewAction {
  title: string;
  /** Qué cambia al confirmar, en una línea. */
  effect: string;
  /** Uno o varios POST con el mismo comentario (invalidar todos los marcados). */
  paths: string[];
  /** La ventana deja de estar pendiente: la bandeja pasa a la siguiente. */
  closesWindow?: boolean;
}

/** Toda decisión lleva un motivo: queda en el historial de la ventana. */
export function DecisionDialog({
  action,
  onClose,
  onDone,
}: {
  action: ReviewAction | null;
  onClose: () => void;
  /** `window` es la ventana como quedó después de la última decisión guardada. */
  onDone: (action: ReviewAction, window: Detail | undefined) => void;
}) {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  // POST ya guardados de esta acción: un reintento tras un fallo parcial no los repite (409).
  const saved = useRef(new Set<string>());
  const mutation = useMutation({
    mutationFn: async (input: { action: ReviewAction; comment: string }) => {
      let window: Detail | undefined;
      // En orden: cada invalidación recalcula la ventana.
      for (const path of input.action.paths.filter((p) => !saved.current.has(p))) {
        window = await apiPost(path, { comment: input.comment }, commentSchema, detailSchema);
        saved.current.add(path);
      }
      return window;
    },
    onSuccess: async (window, input) => {
      reset();
      await refresh();
      onDone(input.action, window);
    },
    onError: async (_error, input) => {
      const done = saved.current.size;
      const total = input.action.paths.length;
      setError(
        done > 0
          ? `Se guardaron ${String(done)} de ${String(total)}. Reintentá para guardar las que faltan.`
          : 'No pudimos guardar la decisión. Revisá el estado de la ventana e intentá de nuevo.',
      );
      await refresh();
    },
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['revision'] }),
      queryClient.invalidateQueries({ queryKey: ['supervision'] }),
    ]);
  const reset = () => {
    setComment('');
    setError('');
    saved.current = new Set();
  };
  const close = () => {
    if (mutation.isPending) return;
    reset();
    onClose();
  };
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending || !action) return;
    if (!commentSchema.safeParse({ comment }).success) {
      setError('Escribí el motivo: entre 5 y 500 caracteres.');
      return;
    }
    mutation.mutate({ action, comment });
  };
  return (
    <Dialog
      open={Boolean(action)}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <DialogTitle>{action?.title}</DialogTitle>
        <DialogDescription className="text-base">{action?.effect}</DialogDescription>
        <form onSubmit={submit} className="space-y-3">
          <Label htmlFor="review-comment" className="text-base">
            Motivo (queda en el historial)
          </Label>
          <Textarea
            id="review-comment"
            rows={4}
            value={comment}
            disabled={mutation.isPending}
            onChange={(event) => {
              setComment(event.target.value);
            }}
            placeholder="Ej.: el vigilador avisó por radio que el GPS fallaba en el galpón."
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'review-comment-error' : undefined}
            maxLength={500}
            aria-required="true"
          />
          {error && (
            <p id="review-comment-error" className="text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close} disabled={mutation.isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Guardando…' : action?.title}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
