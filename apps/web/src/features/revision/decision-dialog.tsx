import { useState, type SyntheticEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { commentSchema, detailSchema } from './review-contracts';

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
  onDone: (action: ReviewAction) => void;
}) {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: async (paths: string[]) => {
      // En orden: cada invalidación recalcula la ventana.
      for (const path of paths) await apiPost(path, { comment }, commentSchema, detailSchema);
    },
    onSuccess: async () => {
      const done = action;
      setComment('');
      setError('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['revision'] }),
        queryClient.invalidateQueries({ queryKey: ['supervision'] }),
      ]);
      if (done) onDone(done);
    },
    onError: async () => {
      setError(
        'No pudimos guardar la decisión. Revisá el estado de la ventana e intentá de nuevo.',
      );
      await queryClient.invalidateQueries({ queryKey: ['revision'] });
    },
  });
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!commentSchema.safeParse({ comment }).success) {
      setError('Escribí el motivo: entre 5 y 500 caracteres.');
      return;
    }
    if (action) mutation.mutate(action.paths);
  };
  return (
    <Dialog
      open={Boolean(action)}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) {
          setError('');
          onClose();
        }
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
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
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
