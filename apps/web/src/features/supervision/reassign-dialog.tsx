import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reassignShiftRequestSchema, reassignShiftResponseSchema } from '@garita/shared';
import { z } from 'zod';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

const guardsSchema = z.object({
  items: z.array(
    z.object({ id: z.string(), firstName: z.string(), lastName: z.string(), status: z.string() }),
  ),
});

export function ReassignDialog({
  shiftId,
  endsAt,
  minutesToSignal,
  open,
  onOpenChange,
  covering,
}: {
  shiftId: string;
  endsAt: string;
  minutesToSignal: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  covering: boolean;
}) {
  const [guardId, setGuardId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [error, setError] = useState('');
  const [openedAt] = useState(() => Date.now());
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['reassign', 'guards'],
    queryFn: () => apiGet('/usuarios?rol=guard&pagina=1', guardsSchema),
    enabled: open,
  });
  const mutation = useMutation({
    mutationFn: () =>
      apiPost(
        `/turnos/${encodeURIComponent(shiftId)}/reasignar`,
        { guardId, ...(startsAt ? { startsAt: new Date(startsAt).toISOString() } : {}) },
        reassignShiftRequestSchema,
        reassignShiftResponseSchema,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['supervision'] });
      onOpenChange(false);
    },
    onError: (cause: unknown) => {
      const body =
        cause instanceof ApiError ? z.object({ message: z.string() }).safeParse(cause.body) : null;
      setError(
        body?.success ? body.data.message : 'No pudimos reasignar el turno. Volvé a intentar.',
      );
    },
  });
  const selected = startsAt ? Date.parse(startsAt) : openedAt;
  const warning =
    minutesToSignal !== null && selected + minutesToSignal * 60_000 > Date.parse(endsAt);
  const invalidTime = Boolean(startsAt) && (selected < openedAt || selected >= Date.parse(endsAt));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{covering ? 'Cubrir el resto' : 'Reasignar turno'}</DialogTitle>
        <DialogDescription>Elegí quién cubrirá el turno y desde cuándo.</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError('');
            if (startsAt && Date.parse(startsAt) < Date.now()) {
              setError('Elegí una hora entre ahora y el fin del turno.');
              return;
            }
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="replacement-guard">Vigilador</Label>
            <NativeSelect
              id="replacement-guard"
              required
              value={guardId}
              onChange={(event) => {
                setGuardId(event.target.value);
              }}
            >
              <NativeSelectOption value="">Elegí un vigilador</NativeSelectOption>
              {data?.items
                .filter((guard) => guard.status === 'active')
                .map((guard) => (
                  <NativeSelectOption key={guard.id} value={guard.id}>
                    {guard.firstName} {guard.lastName}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="replacement-start">Inicio del reemplazo (opcional: ahora)</Label>
            <Input
              id="replacement-start"
              type="datetime-local"
              value={startsAt}
              onChange={(event) => {
                setStartsAt(event.target.value);
              }}
              aria-invalid={invalidTime}
              aria-describedby={invalidTime ? 'replacement-start-error' : undefined}
            />
            {invalidTime && (
              <p id="replacement-start-error" role="alert" className="text-sm text-danger">
                Elegí una hora entre ahora y el fin del turno.
              </p>
            )}
          </div>
          {warning && (
            <Alert role="status">
              El reemplazo podría no llegar al predio antes del fin del turno. Podés confirmar
              igual.
            </Alert>
          )}
          {error && <Alert role="alert">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!guardId || invalidTime || mutation.isPending}>
              {mutation.isPending ? 'Guardando…' : covering ? 'Cubrir el resto' : 'Reasignar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
