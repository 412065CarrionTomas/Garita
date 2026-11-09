import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { closeWithoutDataRequestSchema } from '@garita/shared';
import { z } from 'zod';
import { apiPost, ApiError } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const responseSchema = z.object({
  shiftId: z.string(),
  closedWithoutDataAt: z.iso.datetime(),
  closedWithoutDataById: z.string(),
  reason: z.string(),
});

export function CloseWithoutDataDialog({
  shiftId,
  onClose,
}: {
  shiftId: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: z.infer<typeof closeWithoutDataRequestSchema>) =>
      apiPost(
        `/turnos/${encodeURIComponent(shiftId)}/cerrar-sin-datos`,
        body,
        closeWithoutDataRequestSchema,
        responseSchema,
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['avisos'] }),
        queryClient.invalidateQueries({ queryKey: ['supervision'] }),
      ]);
      onClose();
    },
    onError: (cause: unknown) => {
      const body =
        cause instanceof ApiError ? z.object({ message: z.string() }).safeParse(cause.body) : null;
      setError(body?.success ? body.data.message : 'No pudimos cerrar el turno. Volvé a intentar.');
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>Cerrar sin datos</DialogTitle>
        <DialogDescription>
          Las ventanas pendientes pasarán a no realizadas. La decisión queda registrada con tu
          usuario, la hora y el motivo. Si los datos llegan después, se evaluarán con los registros
          reales.
        </DialogDescription>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = closeWithoutDataRequestSchema.safeParse({ reason });
            if (!parsed.success) {
              setError('Escribí un motivo de entre 5 y 500 caracteres.');
              return;
            }
            if (!confirmed) {
              setError('Confirmá que querés cerrar el turno sin datos.');
              return;
            }
            setError('');
            mutation.mutate(parsed.data);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="close-without-data-reason">Motivo del cierre</Label>
            <Textarea
              id="close-without-data-reason"
              value={reason}
              required
              minLength={5}
              maxLength={500}
              disabled={mutation.isPending}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'close-without-data-error' : undefined}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </div>
          <Label className="flex items-center gap-2">
            <Checkbox
              checked={confirmed}
              disabled={mutation.isPending}
              onCheckedChange={(checked) => {
                setConfirmed(checked === true);
              }}
            />
            Confirmo el cierre sin datos de este turno
          </Label>
          {error && (
            <Alert id="close-without-data-error" variant="destructive">
              {error}
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={mutation.isPending}>
              {mutation.isPending ? 'Cerrando…' : 'Cerrar sin datos'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
