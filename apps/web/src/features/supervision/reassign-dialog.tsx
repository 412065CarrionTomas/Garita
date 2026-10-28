import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  reassignShiftRequestSchema,
  reassignShiftResponseSchema,
  shiftReplacementsResponseSchema,
} from '@garita/shared';
import { z } from 'zod';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

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
  const [warningReceived, setWarningReceived] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const selected = startsAt ? Date.parse(startsAt) : openedAt;
  const invalidTime =
    Boolean(startsAt) &&
    (!Number.isFinite(selected) || selected < openedAt || selected >= Date.parse(endsAt));
  const queryClient = useQueryClient();
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['supervision', 'replacements', shiftId, startsAt],
    queryFn: () =>
      apiGet(
        `/turnos/${encodeURIComponent(shiftId)}/reemplazos${startsAt ? `?startsAt=${encodeURIComponent(new Date(startsAt).toISOString())}` : ''}`,
        shiftReplacementsResponseSchema,
      ),
    enabled: open && !invalidTime,
  });
  const mutation = useMutation({
    mutationFn: () =>
      apiPost(
        `/turnos/${encodeURIComponent(shiftId)}/reasignar`,
        { guardId, ...(startsAt ? { startsAt: new Date(startsAt).toISOString() } : {}) },
        reassignShiftRequestSchema,
        reassignShiftResponseSchema,
      ),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: ['supervision'] });
      if (response.warning) setWarningReceived(true);
      else onOpenChange(false);
    },
    onError: (cause: unknown) => {
      const body =
        cause instanceof ApiError ? z.object({ message: z.string() }).safeParse(cause.body) : null;
      setError(
        body?.success ? body.data.message : 'No pudimos reasignar el turno. Volvé a intentar.',
      );
    },
  });
  const warning =
    minutesToSignal !== null && selected + minutesToSignal * 60_000 > Date.parse(endsAt);
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
            if (invalidTime || (startsAt && Date.parse(startsAt) < Date.now())) {
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
              disabled={isPending || isError || warningReceived}
              onChange={(event) => {
                setGuardId(event.target.value);
              }}
            >
              <NativeSelectOption value="">Elegí un vigilador</NativeSelectOption>
              {data?.map((guard) => (
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
                setGuardId('');
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
          {isPending && !invalidTime && <p role="status">Buscando vigiladores disponibles…</p>}
          {isError && (
            <Alert role="alert">
              No pudimos cargar los reemplazos.{' '}
              <Button type="button" variant="outline" onClick={() => void refetch()}>
                Reintentar
              </Button>
            </Alert>
          )}
          {data?.length === 0 && !invalidTime && (
            <p role="status">No hay vigiladores disponibles para ese horario.</p>
          )}
          {(warning || warningReceived) && (
            <Alert role="status">
              {warningReceived && 'Turno reasignado. '}
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
              {warningReceived ? 'Cerrar' : 'Cancelar'}
            </Button>
            <Button
              type="submit"
              disabled={
                !guardId ||
                !data?.some((guard) => guard.id === guardId) ||
                invalidTime ||
                mutation.isPending ||
                warningReceived ||
                isPending ||
                isError
              }
            >
              {mutation.isPending ? 'Guardando…' : covering ? 'Cubrir el resto' : 'Reasignar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
