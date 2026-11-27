import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  scheduleOperationSchema,
  schedulePreviewSchema,
  shiftScheduleDefinitionSchema,
  shiftScheduleInputSchema,
  type ScheduleOperation,
  type SchedulePreview,
  type ShiftScheduleInput,
  type ShiftScheduleListItem,
} from '@garita/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { errorMessage } from '@/lib/error-message';
import { loadAvailableGuards } from '../../personal/available-guards';
import { WEEKDAYS, WEEK_ORDER, crossesMidnight, dateTime, shortDate } from './schedule-format';

// looseObject: comparte la caché ['predios', 'activos'] con Turnos, que usa el resto.
const sitesSchema = z.array(z.looseObject({ id: z.string(), name: z.string() }));
// looseObject: comparte la caché ['rondas', predio] con Predios → Rondas, que necesita el resto.
const roundsSchema = z.array(
  z.looseObject({ id: z.string(), name: z.string(), status: z.string() }),
);
const emptyForm: ShiftScheduleInput = {
  siteId: '',
  guardId: '',
  roundIds: [],
  weekdays: [],
  startTime: '22:00',
  endTime: '06:00',
  startDate: '',
  endDate: '',
};

/** Días en que empieza el turno, como botones compactos que se marcan con Tab y Espacio. */
export function WeekdaySelector({
  value,
  onChange,
}: {
  value: number[];
  onChange: (value: number[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">
        Días en que empieza el turno{' '}
        <span role="status" className="font-normal text-muted-foreground">
          · {value.length} {value.length === 1 ? 'elegido' : 'elegidos'}
        </span>
      </legend>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEK_ORDER.map((day) => (
          <Label
            key={day}
            className="relative flex min-h-10 cursor-pointer items-center justify-center rounded-md border-[1.5px] border-input px-1 py-1.5 text-sm font-semibold has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary has-[[data-state=checked]]:text-primary-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2"
          >
            <Checkbox
              aria-label={WEEKDAYS[day]?.long}
              name="weekdays"
              checked={value.includes(day)}
              onCheckedChange={(checked) => {
                onChange(
                  checked === true
                    ? [...new Set([...value, day])]
                    : value.filter((item) => item !== day),
                );
              }}
              className="sr-only"
            />
            <span aria-hidden="true">{WEEKDAYS[day]?.short}</span>
          </Label>
        ))}
      </div>
    </fieldset>
  );
}

/** Resumen de la vista previa: primero lo que necesita una decisión (conflictos y huecos). */
export function SchedulePreviewTable({
  preview,
  roundNames = new Map<string, string>(),
}: {
  preview: SchedulePreview;
  roundNames?: Map<string, string>;
}) {
  const conflicts = preview.shifts.filter((shift) => shift.conflicts.length);
  const tz = preview.timezone;
  return (
    <section aria-label="Vista previa" className="space-y-3">
      <h3 className="text-base font-semibold">Vista previa</h3>
      <p role="status" className="text-base">
        <b className="tabular-nums">{preview.shifts.length - conflicts.length}</b> turnos a generar
        · <b className="tabular-nums">{conflicts.length}</b> con conflicto ·{' '}
        <b className="tabular-nums">{preview.uncoveredWindows.length}</b> ventanas sin cubrir
      </p>
      {preview.invitationPending && (
        <Alert variant="neutral">El vigilador tiene una invitación pendiente.</Alert>
      )}
      {conflicts.length > 0 && (
        <Alert variant="destructive" className="space-y-1">
          <p className="font-semibold">
            Conflicto: no se generará{conflicts.length > 1 ? 'n' : ''} {conflicts.length}{' '}
            {conflicts.length > 1 ? 'turnos' : 'turno'}
          </p>
          <ul className="list-disc pl-5">
            {conflicts.map((shift) => (
              <li key={shift.serviceDate}>
                {shortDate(shift.serviceDate)}: el vigilador ya tiene un turno de{' '}
                {shift.conflicts
                  .map(
                    (conflict) =>
                      `${dateTime(conflict.startsAt, tz)} a ${dateTime(conflict.endsAt, tz)}`,
                  )
                  .join(' y ')}
                .
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {preview.uncoveredWindows.length > 0 && (
        <Alert variant="neutral" className="space-y-1">
          <p>Hay ventanas que ningún turno cubre. Podés confirmar igualmente.</p>
          <ul className="list-disc pl-5">
            {preview.uncoveredWindows.map((window) => (
              <li key={`${window.roundId}:${window.startUtc}`}>
                {new Date(window.startUtc).toLocaleDateString('es-AR', { timeZone: tz })} ·{' '}
                {window.label} · {roundNames.get(window.roundId) ?? 'Ronda'}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <details className="rounded-md border-[1.5px] border-input">
        <summary className="cursor-pointer px-3 py-2 font-semibold">
          Ver los {preview.shifts.length} turnos ({tz})
        </summary>
        <ul className="divide-y divide-border">
          {preview.shifts.map((shift) => (
            <li
              key={shift.serviceDate}
              className="flex items-center justify-between gap-3 px-3 py-2 tabular-nums"
            >
              <span>
                {dateTime(shift.startsAt, tz)} a {dateTime(shift.endsAt, tz)}
              </span>
              <span className={shift.conflicts.length ? 'font-semibold text-danger' : undefined}>
                {shift.conflicts.length ? 'No se generará' : 'Se generará'}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/**
 * Alta y modificación en un modal grande, como el de predios y puntos: los datos a la izquierda y
 * la vista previa a la derecha, para revisar los turnos sin perder el formulario de vista.
 */
export function ScheduleFormDialog({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: ShiftScheduleListItem | null;
  onClose: () => void;
  onSaved: (result: ScheduleOperation) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        aria-describedby="schedule-form-description"
        className="w-[calc(100%-2rem)] max-w-6xl"
      >
        {open && (
          <ScheduleForm
            key={editing?.id ?? 'new'}
            editing={editing}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: ShiftScheduleListItem | null;
  onClose: () => void;
  onSaved: (result: ScheduleOperation) => void;
}) {
  // El período aprobado no se toca al modificar: la API regenera solo desde hoy.
  const [form, setForm] = useState<ShiftScheduleInput>(() =>
    editing
      ? {
          siteId: editing.siteId,
          guardId: editing.guardId,
          roundIds: editing.roundIds,
          weekdays: editing.weekdays,
          startTime: editing.startTime,
          endTime: editing.endTime,
          startDate: editing.startDate,
          endDate: editing.endDate,
        }
      : emptyForm,
  );
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const inputSchema = editing ? shiftScheduleDefinitionSchema : shiftScheduleInputSchema;
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
  const fail = (failure: unknown) => {
    setError(errorMessage(failure));
    requestAnimationFrame(() => errorRef.current?.focus());
  };
  const query = editing ? `?programacion=${encodeURIComponent(editing.id)}` : '';
  const preview = useMutation({
    mutationFn: (input: ShiftScheduleInput) =>
      apiPost(
        `/programaciones-turnos/previsualizar${query}`,
        input,
        inputSchema,
        schedulePreviewSchema,
      ),
  });
  const save = useMutation({
    mutationFn: (input: ShiftScheduleInput) =>
      editing
        ? apiPatch(
            `/programaciones-turnos/${editing.id}`,
            input,
            inputSchema,
            scheduleOperationSchema,
          )
        : apiPost(
            '/programaciones-turnos',
            input,
            shiftScheduleInputSchema,
            scheduleOperationSchema,
          ),
    onSuccess: onSaved,
    onError: fail,
  });
  const set = (patch: Partial<ShiftScheduleInput>) => {
    setForm((previous) => ({ ...previous, ...patch }));
    preview.reset();
    setError('');
  };
  const parsed = inputSchema.safeParse(form);
  // La vista previa vale solo para los datos con que se pidió.
  const current =
    preview.data &&
    parsed.success &&
    JSON.stringify(parsed.data) === JSON.stringify(preview.variables)
      ? preview.data
      : null;
  const pending = save.isPending || preview.isPending;
  const roundNames = new Map((rounds.data ?? []).map((round) => [round.id, round.name]));
  // Las activas, más las dadas de baja que la programación ya tenía: así se pueden desmarcar.
  const activeRounds = (rounds.data ?? []).filter(
    (round) => round.status === 'active' || form.roundIds.includes(round.id),
  );

  // La vista previa se pide sola cuando los datos están completos, con una pausa para no
  // consultar en cada tecla.
  const previewKey = parsed.success ? JSON.stringify(parsed.data) : '';
  useEffect(() => {
    if (!parsed.success) return;
    const input = parsed.data;
    const timer = setTimeout(() => {
      preview.mutate(input);
    }, 400);
    return () => {
      clearTimeout(timer);
    };
    // Solo depende de los datos: `parsed` y `preview` cambian en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);
  const previewHint = preview.isError
    ? `No se pudo calcular: ${preview.error instanceof Error ? preview.error.message : 'revisá los datos'}.`
    : parsed.success
      ? 'Calculando los turnos…'
      : 'Se calcula sola al completar predio, vigilador, días, vigencia y una ronda.';

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError('');
        if (current && parsed.success) save.mutate(parsed.data);
      }}
    >
      <div className="space-y-1">
        <DialogTitle className="text-lg font-semibold">
          {editing ? 'Modificar programación' : 'Nueva programación'}
        </DialogTitle>
        <DialogDescription id="schedule-form-description">
          Una guardia semanal en el horario de la empresa. Feriados y esquemas rotativos se cargan
          como turnos sueltos.
        </DialogDescription>
      </div>
      {(sites.isError || guards.isError || rounds.isError) && (
        <Alert>
          No se pudieron cargar las opciones del formulario.{' '}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void sites.refetch();
              void guards.refetch();
              if (form.siteId) void rounds.refetch();
            }}
          >
            Reintentar opciones
          </Button>
        </Alert>
      )}
      <div className="grid gap-6 text-base lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="schedule-site">Predio</Label>
              <NativeSelect
                id="schedule-site"
                className="w-full"
                required
                value={form.siteId}
                onChange={(event) => {
                  set({ siteId: event.target.value, roundIds: [] });
                }}
              >
                <NativeSelectOption value="">Elegí un predio</NativeSelectOption>
                {sites.data?.map((site) => (
                  <NativeSelectOption key={site.id} value={site.id}>
                    {site.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schedule-guard">Vigilador</Label>
              <NativeSelect
                id="schedule-guard"
                className="w-full"
                required
                value={form.guardId}
                onChange={(event) => {
                  set({ guardId: event.target.value });
                }}
              >
                <NativeSelectOption value="">Elegí un vigilador</NativeSelectOption>
                {guards.data?.items.map((guard) => (
                  <NativeSelectOption key={guard.id} value={guard.id}>
                    {guard.firstName} {guard.lastName}
                    {guard.status === 'invitation_pending' ? ' (invitación pendiente)' : ''}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <WeekdaySelector
            value={form.weekdays}
            onChange={(weekdays) => {
              set({ weekdays });
            }}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="schedule-startTime">Hora de inicio</Label>
              <Input
                id="schedule-startTime"
                type="time"
                required
                value={form.startTime}
                onChange={(event) => {
                  set({ startTime: event.target.value });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schedule-endTime">Hora de fin</Label>
              <Input
                id="schedule-endTime"
                type="time"
                required
                value={form.endTime}
                aria-describedby="schedule-hint"
                onChange={(event) => {
                  set({ endTime: event.target.value });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schedule-startDate">Desde</Label>
              <Input
                id="schedule-startDate"
                type="date"
                required
                value={form.startDate}
                onChange={(event) => {
                  set({ startDate: event.target.value });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schedule-endDate">Hasta (incluido)</Label>
              <Input
                id="schedule-endDate"
                type="date"
                required
                value={form.endDate}
                aria-describedby="schedule-hint"
                onChange={(event) => {
                  set({ endDate: event.target.value });
                }}
              />
            </div>
            <p id="schedule-hint" className="text-sm text-muted-foreground sm:col-span-2">
              {crossesMidnight(form.startTime, form.endTime)
                ? 'Termina al día siguiente.'
                : 'Termina el mismo día.'}{' '}
              Hasta tres meses por período; después se puede extender.
            </p>
          </div>
        </div>
        <div className="min-w-0 space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Rondas (al menos una)</legend>
            {!form.siteId ? (
              <p className="text-sm text-muted-foreground">Elegí un predio para ver sus rondas.</p>
            ) : rounds.isSuccess && activeRounds.length === 0 ? (
              <Alert role="status" className="border-warning bg-warning-soft text-warning">
                Este predio no tiene rondas activas.
              </Alert>
            ) : (
              <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {activeRounds.map((round) => (
                  <label
                    key={round.id}
                    className="flex min-h-8 cursor-pointer items-center gap-2 text-base"
                  >
                    <Checkbox
                      name="roundIds"
                      aria-label={round.name}
                      checked={form.roundIds.includes(round.id)}
                      onCheckedChange={(checked) => {
                        set({
                          roundIds:
                            checked === true
                              ? [...new Set([...form.roundIds, round.id])]
                              : form.roundIds.filter((id) => id !== round.id),
                        });
                      }}
                    />
                    <span className="truncate">
                      {round.name}
                      {round.status !== 'active' && (
                        <span className="text-muted-foreground"> (dada de baja)</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          {current ? (
            <SchedulePreviewTable preview={current} roundNames={roundNames} />
          ) : (
            <div
              role="status"
              className="rounded-md border-[1.5px] border-dashed border-input p-4 text-muted-foreground"
            >
              <p className="font-semibold text-foreground">Vista previa</p>
              <p>{previewHint}</p>
            </div>
          )}
        </div>
      </div>
      {error && (
        <div
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="rounded-md border border-danger bg-danger-soft p-4 text-danger"
        >
          {error}
        </div>
      )}
      <footer className="flex flex-wrap justify-end gap-2 border-t-[1.5px] border-input pt-4">
        <Button type="button" variant="outline" onClick={onClose}>
          Cerrar
        </Button>
        <Button type="submit" disabled={!current || pending}>
          {save.isPending
            ? 'Confirmando…'
            : editing
              ? 'Confirmar modificación'
              : 'Confirmar programación'}
        </Button>
      </footer>
    </form>
  );
}
