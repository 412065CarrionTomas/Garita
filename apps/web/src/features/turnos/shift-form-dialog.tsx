import {
  addDays,
  computeRoundWindows,
  findUncoveredWindows,
  localDateTimeToUtc,
  shiftInputSchema,
  windowsForShift,
} from '@garita/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type SyntheticEvent } from 'react';
import { z } from 'zod';
import { Stamp } from '@/components/stamp';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { useBusy } from '@/lib/use-busy';
import { loadAvailableGuards } from '../personal/available-guards';
import {
  formatDateTime,
  roundsSchema,
  shiftPageSchema,
  shiftRowSchema,
  sitesSchema,
  timeToMinutes,
  type ShiftRow,
} from './shift-utils';

/** Qué abre el editor: un turno existente o uno nuevo, opcionalmente con predio y día elegidos. */
export type ShiftEditorTarget = { shiftId: string } | { siteId?: string; date?: string };

interface FormValues {
  siteId: string;
  guardId: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  roundIds: string[];
}

const shiftResponseSchema = z.looseObject({ id: z.string() });
const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

export function ShiftEditor({
  target,
  onClose,
  onSaved,
}: {
  target: ShiftEditorTarget | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const shiftId = target && 'shiftId' in target ? target.shiftId : null;
  const shift = useQuery({
    queryKey: ['turnos', 'detalle', shiftId],
    queryFn: () => apiGet(`/turnos/${encodeURIComponent(shiftId ?? '')}`, shiftRowSchema),
    enabled: Boolean(shiftId),
  });
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-labelledby="shift-form-title" aria-describedby="shift-form-description">
        {shiftId && shift.isError ? (
          <>
            <DialogTitle id="shift-form-title">Editar turno</DialogTitle>
            <DialogDescription id="shift-form-description">
              No se pudo cargar el turno.
            </DialogDescription>
            <Button variant="outline" onClick={() => void shift.refetch()}>
              Reintentar
            </Button>
          </>
        ) : shiftId && !shift.data ? (
          <div role="status" aria-label="Cargando turno" className="space-y-3">
            <DialogTitle id="shift-form-title">Editar turno</DialogTitle>
            <DialogDescription id="shift-form-description" className="sr-only">
              Cargando turno
            </DialogDescription>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          target && (
            <ShiftForm
              key={shiftId ?? 'new'}
              editing={shift.data ?? null}
              initial={initialValues(target, shift.data)}
              onClose={onClose}
              onSaved={onSaved}
            />
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

function initialValues(target: ShiftEditorTarget, shift: ShiftRow | undefined): FormValues {
  if (shift) {
    const timezone = shift.site.company.timezone;
    const start = formatDateTime(shift.startsAt, timezone);
    const end = formatDateTime(shift.endsAt, timezone);
    return {
      siteId: shift.siteId,
      guardId: shift.assignments[0]?.guard?.id ?? '',
      startDate: start.date,
      startTime: start.time,
      endDate: end.date,
      endTime: end.time,
      roundIds: shift.rounds.map((item) => item.roundId),
    };
  }
  const fresh = 'shiftId' in target ? {} : target;
  return {
    siteId: fresh.siteId ?? '',
    guardId: '',
    startDate: fresh.date ?? '',
    startTime: '08:00',
    endDate: fresh.date ?? '',
    endTime: '16:00',
    roundIds: [],
  };
}

function ShiftForm({
  editing,
  initial,
  onClose,
  onSaved,
}: {
  editing: ShiftRow | null;
  initial: FormValues;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { busy, run } = useBusy();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState('');
  const set = (patch: Partial<FormValues>) => {
    setForm((old) => ({ ...old, ...patch }));
  };
  const sites = useQuery({
    queryKey: ['predios', 'activos'],
    queryFn: () => apiGet('/predios?estado=active', sitesSchema),
  });
  const guards = useQuery({ queryKey: ['personal', 'vigiladores'], queryFn: loadAvailableGuards });
  const rounds = useQuery({
    queryKey: ['rondas', form.siteId],
    queryFn: () => apiGet(`/predios/${form.siteId}/rondas`, roundsSchema),
    enabled: Boolean(form.siteId),
  });
  const selectedSite = sites.data?.find((site) => site.id === form.siteId);
  const timezone = selectedSite?.company.timezone ?? DEFAULT_TIMEZONE;
  // Turnos vecinos del mismo predio: solo para avisar qué ventanas quedan sin cubrir.
  const neighbours = useQuery({
    queryKey: ['turnos', 'vecinos', form.siteId, form.startDate],
    queryFn: () =>
      apiGet(
        `/turnos?${new URLSearchParams({
          predio: form.siteId,
          desde: new Date(`${addDays(form.startDate, -1)}T00:00:00Z`).toISOString(),
          hasta: new Date(`${addDays(form.startDate, 2)}T00:00:00Z`).toISOString(),
          porPagina: '100',
        }).toString()}`,
        shiftPageSchema,
      ),
    enabled: Boolean(form.siteId && form.startDate),
  });
  const activeRounds = (rounds.data ?? []).filter((round) => round.status === 'active');

  const preview = useMemo(() => {
    if (!form.startDate || !form.startTime || !form.endDate || !form.endTime)
      return { expected: [], uncovered: [] };
    const startsAt = localDateTimeToUtc(
      form.startDate,
      timeToMinutes(form.startTime),
      timezone,
    ).toISOString();
    const endsAt = localDateTimeToUtc(
      form.endDate,
      timeToMinutes(form.endTime),
      timezone,
    ).toISOString();
    const configs = (rounds.data ?? [])
      .filter((round) => form.roundIds.includes(round.id))
      .flatMap((round) =>
        round.currentVersion ? [{ roundId: round.id, version: round.currentVersion }] : [],
      );
    const windows = configs.flatMap(({ roundId, version }) =>
      [addDays(form.startDate, -1), form.startDate].flatMap((date) =>
        computeRoundWindows(date, { ...version, timezone }).map((window) => ({
          ...window,
          roundId,
        })),
      ),
    );
    const expected = configs.flatMap(({ roundId }) =>
      windowsForShift(
        windows.filter((window) => window.roundId === roundId),
        { shiftStartUtc: startsAt, shiftEndUtc: endsAt },
      ).endingInShift.map(({ label }) => label),
    );
    const others = (neighbours.data?.items ?? [])
      .filter((shift) => shift.id !== editing?.id)
      .map((shift) => ({
        id: shift.id,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        // La cobertura solo distingue los turnos cancelados.
        status: shift.status.startsWith('cancelled') ? ('cancelled' as const) : undefined,
        roundIds: shift.rounds.map((item) => item.roundId),
      }));
    const uncovered = findUncoveredWindows(
      windows.filter((window) => form.roundIds.includes(window.roundId)),
      [{ id: editing?.id ?? 'new', startsAt, endsAt, roundIds: form.roundIds }, ...others],
    );
    return { expected, uncovered: [...new Set(uncovered.map((window) => window.label))] };
  }, [form, rounds.data, timezone, neighbours.data, editing?.id]);

  const saveNow = async () => {
    setError('');
    setFieldErrors({});
    setConflict('');
    if (!selectedSite) {
      setFieldErrors({ siteId: 'Seleccioná un predio.' });
      return;
    }
    const parsed = shiftInputSchema.safeParse({
      siteId: form.siteId,
      guardId: form.guardId || null,
      startsAt: localDateTimeToUtc(
        form.startDate,
        timeToMinutes(form.startTime),
        timezone,
      ).toISOString(),
      endsAt: localDateTimeToUtc(form.endDate, timeToMinutes(form.endTime), timezone).toISOString(),
      roundIds: form.roundIds,
    });
    if (!parsed.success) {
      setFieldErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0] ?? 'form'), issue.message]),
        ),
      );
      setError(parsed.error.issues[0]?.message ?? 'Revisá los datos del turno.');
      return;
    }
    try {
      if (editing)
        await apiPatch(`/turnos/${editing.id}`, parsed.data, shiftInputSchema, shiftResponseSchema);
      else await apiPost('/turnos', parsed.data, shiftInputSchema, shiftResponseSchema);
      onSaved(editing ? 'Turno actualizado.' : 'Turno creado.');
    } catch (cause) {
      if (cause instanceof ApiError && typeof cause.body === 'object' && cause.body !== null) {
        const body = cause.body as {
          code?: unknown;
          message?: unknown;
          shift?: { site?: { name?: unknown } };
        };
        if (body.code === 'SHIFT_OVERLAP') {
          setConflict(
            typeof body.shift?.site?.name === 'string'
              ? body.shift.site.name
              : 'otro turno del vigilador',
          );
          setError('El vigilador ya tiene un turno superpuesto.');
          return;
        }
        if (body.code === 'SHIFT_STARTED') {
          setError('Solo se puede reasignar este turno porque ya pasó la hora de inicio.');
          return;
        }
        setError(typeof body.message === 'string' ? body.message : 'No se pudo guardar el turno.');
      } else setError('No se pudo guardar el turno. Verificá los datos e intentá nuevamente.');
    }
  };
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(saveNow);
  };
  const fieldError = (key: string, id: string) =>
    fieldErrors[key] && (
      <span className="text-sm text-danger" id={id}>
        {fieldErrors[key]}
      </span>
    );

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="space-y-1">
        <DialogTitle id="shift-form-title">{editing ? 'Editar turno' : 'Nuevo turno'}</DialogTitle>
        <DialogDescription id="shift-form-description">
          Horarios en la zona de la empresa ({timezone}).
        </DialogDescription>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label className="grid gap-1">
          Predio
          <NativeSelect
            required
            value={form.siteId}
            aria-label="Predio del turno"
            aria-invalid={Boolean(fieldErrors.siteId)}
            aria-describedby={fieldErrors.siteId ? 'shift-site-error' : undefined}
            onChange={(event) => {
              set({ siteId: event.target.value, roundIds: [] });
            }}
            className="w-full"
          >
            <NativeSelectOption value="">Seleccioná un predio</NativeSelectOption>
            {sites.data
              ?.filter((site) => site.status === 'active')
              .map((site) => (
                <NativeSelectOption key={site.id} value={site.id}>
                  {site.name}
                </NativeSelectOption>
              ))}
          </NativeSelect>
          {fieldError('siteId', 'shift-site-error')}
        </Label>
        <Label className="grid gap-1">
          Vigilador
          <NativeSelect
            value={form.guardId}
            aria-label="Vigilador del turno"
            aria-invalid={Boolean(fieldErrors.guardId)}
            aria-describedby={fieldErrors.guardId ? 'shift-guard-error' : undefined}
            onChange={(event) => {
              set({ guardId: event.target.value });
            }}
            className="w-full"
          >
            <NativeSelectOption value="">Sin vigilador</NativeSelectOption>
            {guards.data?.items
              .filter((guard) => guard.status === 'active' || guard.status === 'invitation_pending')
              .map((guard) => (
                <NativeSelectOption key={guard.id} value={guard.id}>
                  {guard.firstName} {guard.lastName}
                  {guard.status === 'invitation_pending' ? ' · invitación pendiente' : ''}
                </NativeSelectOption>
              ))}
          </NativeSelect>
          {fieldError('guardId', 'shift-guard-error')}
        </Label>
        <Label className="grid gap-1">
          Empieza
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input
              required
              type="date"
              aria-label="Fecha de inicio"
              value={form.startDate}
              aria-invalid={Boolean(fieldErrors.startsAt)}
              aria-describedby={fieldErrors.startsAt ? 'shift-start-error' : undefined}
              onChange={(event) => {
                // El fin acompaña al inicio mientras no se haya elegido otro día.
                set({
                  startDate: event.target.value,
                  ...(form.endDate === form.startDate || !form.endDate
                    ? { endDate: event.target.value }
                    : {}),
                });
              }}
            />
            <Input
              required
              type="time"
              step="60"
              aria-label="Hora de inicio (24 h)"
              value={form.startTime}
              onChange={(event) => {
                set({ startTime: event.target.value });
              }}
            />
          </div>
          {fieldError('startsAt', 'shift-start-error')}
        </Label>
        <Label className="grid gap-1">
          Termina
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input
              required
              type="date"
              aria-label="Fecha de fin"
              value={form.endDate}
              aria-invalid={Boolean(fieldErrors.endsAt)}
              aria-describedby={fieldErrors.endsAt ? 'shift-end-error' : undefined}
              onChange={(event) => {
                set({ endDate: event.target.value });
              }}
            />
            <Input
              required
              type="time"
              step="60"
              aria-label="Hora de fin (24 h)"
              value={form.endTime}
              onChange={(event) => {
                set({ endTime: event.target.value });
              }}
            />
          </div>
          {fieldError('endsAt', 'shift-end-error')}
        </Label>
      </div>
      <fieldset
        aria-invalid={Boolean(fieldErrors.roundIds)}
        aria-describedby={fieldErrors.roundIds ? 'shift-rounds-error' : undefined}
        className="space-y-2"
      >
        <legend className="mb-1 text-sm font-semibold">Rondas del predio</legend>
        {!form.siteId ? (
          <p className="text-sm text-muted-foreground">Elegí un predio para ver sus rondas.</p>
        ) : rounds.isSuccess && activeRounds.length === 0 ? (
          <Alert role="status" className="border-warning bg-warning-soft text-warning">
            Este predio no tiene rondas activas. Creá una en Predios antes de cargar el turno.
          </Alert>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {activeRounds.map((round) => (
              <Label key={round.id} className="flex items-center gap-2 text-base font-normal">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={form.roundIds.includes(round.id)}
                  onChange={(event) => {
                    set({
                      roundIds: event.target.checked
                        ? [...form.roundIds, round.id]
                        : form.roundIds.filter((id) => id !== round.id),
                    });
                  }}
                />
                {round.name}
              </Label>
            ))}
          </div>
        )}
        {fieldErrors.roundIds && (
          <p className="text-sm text-danger" id="shift-rounds-error">
            {fieldErrors.roundIds}
          </p>
        )}
      </fieldset>
      {preview.uncovered.length > 0 && (
        <Alert role="status" className="border-warning bg-warning-soft text-warning">
          Estas ventanas no quedan cubiertas por ningún turno: {preview.uncovered.join(', ')}. Podés
          guardar igual.
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          {error}
          {conflict ? ` Turno en conflicto: ${conflict}.` : ''}
        </Alert>
      )}
      <footer className="flex flex-wrap items-center gap-3 border-t pt-4">
        <section aria-labelledby="expected-windows-title" className="mr-auto min-w-0">
          <h3 id="expected-windows-title" className="text-sm font-semibold">
            Ventanas esperadas: {preview.expected.length}
          </h3>
          {preview.expected.length > 0 ? (
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {preview.expected.map((window, index) => (
                <li key={`${window}-${index}`}>
                  <Stamp>{window}</Stamp>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Elegí horario y rondas para calcularlas.
            </p>
          )}
        </section>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          Guardar turno
        </Button>
      </footer>
    </form>
  );
}
