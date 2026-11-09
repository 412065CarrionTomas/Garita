import { useState, type SyntheticEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { panicAlertDetailSchema, resolvePanicAlertRequestSchema } from '@garita/shared';
import type { ResolvePanicAlertRequest } from '@garita/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { apiPost } from '@/lib/api-client';
import { panicOutcomes } from './queries';

export function ResolvePanicDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const client = useQueryClient();
  const [outcome, setOutcome] = useState('');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: (body: ResolvePanicAlertRequest) =>
      apiPost(
        `/alertas-panico/${id}/resolver`,
        body,
        resolvePanicAlertRequestSchema,
        panicAlertDetailSchema,
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['panico'] });
      onClose();
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: ['panico'] });
    },
  });
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const parsed = resolvePanicAlertRequestSchema.safeParse({ outcome, comment });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0]),
            issue.path[0] === 'comment'
              ? 'Escribí entre 5 y 1.000 caracteres.'
              : 'Elegí un resultado.',
          ]),
        ),
      );
      return;
    }
    setErrors({});
    mutation.mutate(parsed.data);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>Resolver alerta de pánico</DialogTitle>
        <DialogDescription>
          El resultado, comentario, autor y hora quedarán registrados.
        </DialogDescription>
        <form aria-label="Resolver alerta" onSubmit={submit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="panic-outcome">Resultado</Label>
            <NativeSelect
              id="panic-outcome"
              value={outcome}
              onChange={(event) => {
                setOutcome(event.target.value);
              }}
              aria-invalid={!!errors.outcome}
              aria-describedby="panic-outcome-error"
            >
              <NativeSelectOption value="">Elegí un resultado</NativeSelectOption>
              {Object.entries(panicOutcomes).map(([value, text]) => (
                <NativeSelectOption key={value} value={value}>
                  {text}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {errors.outcome && (
              <p id="panic-outcome-error" role="alert" className="text-sm text-danger">
                {errors.outcome}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="panic-comment">Comentario</Label>
            <Textarea
              id="panic-comment"
              value={comment}
              maxLength={1000}
              onChange={(event) => {
                setComment(event.target.value);
              }}
              aria-invalid={!!errors.comment}
              aria-describedby="panic-comment-help panic-comment-error"
            />
            <p id="panic-comment-help" className="text-sm text-muted-foreground">
              Entre 5 y 1.000 caracteres.
            </p>
            {errors.comment && (
              <p id="panic-comment-error" role="alert" className="text-sm text-danger">
                {errors.comment}
              </p>
            )}
          </div>
          {mutation.isError && (
            <Alert variant="destructive">
              No se pudo resolver. Revisá si alguien ya cambió el estado e intentá nuevamente.
            </Alert>
          )}
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" type="button" disabled={mutation.isPending} onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Guardando…' : 'Guardar resolución'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
