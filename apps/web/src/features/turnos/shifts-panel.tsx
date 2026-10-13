import {
  computeRoundWindows,
  findUncoveredWindows,
  localDateTimeToUtc,
  shiftInputSchema,
  windowsForShift,
} from '@garita/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { z } from 'zod';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api-client';

const shiftRowsSchema = z.array(
  z.looseObject({
    id: z.string(),
    siteId: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    serviceDate: z.string(),
    status: z.enum(['scheduled', 'unassigned', 'cancelled']),
    site: z.looseObject({ name: z.string(), company: z.looseObject({ timezone: z.string() }) }),
    assignments: z.array(
      z.looseObject({
        guard: z
          .looseObject({
            id: z.string(),
            firstName: z.string(),
            lastName: z.string(),
            status: z.string(),
          })
          .nullable(),
      }),
    ),
    rounds: z.array(
      z.looseObject({
        roundId: z.string(),
        round: z.looseObject({
          name: z.string(),
          currentVersion: z
            .looseObject({
              windowStartLocal: z.string(),
              windowEndLocal: z.string(),
              frequencyMinutes: z.number(),
            })
            .nullable(),
        }),
      }),
    ),
  }),
);
const sitesSchema = z.array(
  z.looseObject({
    id: z.string(),
    name: z.string(),
    status: z.enum(['active', 'inactive']),
    company: z.looseObject({ timezone: z.string() }),
  }),
);
const guardsSchema = z.looseObject({
  items: z.array(
    z.looseObject({
      id: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      status: z.string(),
    }),
  ),
});
const roundsSchema = z.array(
  z.looseObject({
    id: z.string(),
    name: z.string(),
    status: z.enum(['active', 'inactive']),
    currentVersion: z
      .looseObject({
        windowStartLocal: z.string(),
        windowEndLocal: z.string(),
        frequencyMinutes: z.number(),
      })
      .nullable(),
  }),
);
const shiftResponseSchema = z.looseObject({ id: z.string() });
const emptySchema = z.object({});

type Shift = z.infer<typeof shiftRowsSchema>[number];
interface FormValues {
  siteId: string;
  guardId: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  roundIds: string[];
}
const emptyForm: FormValues = {
  siteId: '',
  guardId: '',
  startDate: '',
  startTime: '08:00',
  endDate: '',
  endTime: '16:00',
  roundIds: [],
};

export function ShiftsPanel() {
  const [siteId, setSiteId] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [guardId, setGuardId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeUnassigned, setIncludeUnassigned] = useState(true);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [cancelId, setCancelId] = useState('');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflictingShift, setConflictingShift] = useState('');
  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 15_000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);
  const params = new URLSearchParams();
  if (siteId) params.set('predio', siteId);
  if (guardId) params.set('vigilador', guardId);
  if (from) params.set('desde', new Date(`${from}T00:00:00`).toISOString());
  if (to) params.set('hasta', new Date(`${to}T23:59:59`).toISOString());
  if (!includeUnassigned) params.set('sinVigilador', 'false');
  const shifts = useQuery({
    queryKey: ['turnos', siteId, guardId, from, to, includeUnassigned],
    queryFn: () => apiGet(`/turnos?${params.toString()}`, shiftRowsSchema),
  });
  const sites = useQuery({
    queryKey: ['predios', 'activos'],
    queryFn: () => apiGet('/predios?estado=active', sitesSchema),
  });
  const guards = useQuery({
    queryKey: ['personal', 'vigiladores'],
    queryFn: () => apiGet('/usuarios?rol=guard&pagina=1', guardsSchema),
  });
  const selectedSite = sites.data?.find((site) => site.id === form.siteId);
  const rounds = useQuery({
    queryKey: ['rondas', form.siteId],
    queryFn: () => apiGet(`/predios/${form.siteId}/rondas`, roundsSchema),
    enabled: Boolean(form.siteId),
  });
  const timezone = selectedSite?.company.timezone ?? 'America/Argentina/Buenos_Aires';
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
    const configs =
      rounds.data
        ?.filter((round) => form.roundIds.includes(round.id))
        .flatMap((round) => {
          const version = round.currentVersion;
          return version ? [{ roundId: round.id, version }] : [];
        }) ?? [];
    const windows = configs.flatMap(({ roundId, version }) =>
      [previousDate(form.startDate), form.startDate].flatMap((date) =>
        computeRoundWindows(date, { ...version, timezone }).map((window) => ({
          ...window,
          roundId,
        })),
      ),
    );
    const expected = configs.flatMap(({ roundId }) => {
      const roundWindows = windows.filter((window) => window.roundId === roundId);
      return windowsForShift(roundWindows, {
        shiftStartUtc: startsAt,
        shiftEndUtc: endsAt,
      }).endingInShift.map(({ label }) => label);
    });
    const otherShifts = (shifts.data ?? [])
      .map((shift) => ({
        id: shift.id,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        status: shift.status,
        roundIds: shift.rounds.map((item) => item.roundId),
      }))
      .filter((shift) => shift.id !== editing?.id);
    const own = windows.filter((window) => form.roundIds.includes(window.roundId));
    const uncovered = findUncoveredWindows(own, [
      { id: editing?.id ?? 'new', startsAt, endsAt, roundIds: form.roundIds },
      ...otherShifts,
    ]);
    return { expected, uncovered: [...new Set(uncovered.map((window) => window.label))] };
  }, [form, rounds.data, timezone, shifts.data, editing?.id]);

  const openForm = (shift?: Shift) => {
    setFormOpen(true);
    setEditing(shift ?? null);
    setForm(
      shift
        ? {
            siteId: shift.siteId,
            guardId: shift.assignments[0]?.guard?.id ?? '',
            startDate: formatDateTime(shift.startsAt, shift.site.company.timezone).date,
            startTime: formatDateTime(shift.startsAt, shift.site.company.timezone).time,
            endDate: formatDateTime(shift.endsAt, shift.site.company.timezone).date,
            endTime: formatDateTime(shift.endsAt, shift.site.company.timezone).time,
            roundIds: shift.rounds.map((item) => item.roundId),
          }
        : { ...emptyForm, siteId: siteId || '', startDate: from || '', endDate: from || '' },
    );
    setFormError('');
    setFieldErrors({});
    setConflictingShift('');
  };

  const save = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setFieldErrors({});
    setConflictingShift('');
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
      setFormError(parsed.error.issues[0]?.message ?? 'Revisá los datos del turno.');
      return;
    }
    try {
      if (editing)
        await apiPatch(`/turnos/${editing.id}`, parsed.data, shiftInputSchema, shiftResponseSchema);
      else await apiPost('/turnos', parsed.data, shiftInputSchema, shiftResponseSchema);
      setMessage(editing ? 'Turno actualizado.' : 'Turno creado.');
      setFormError('');
      setFieldErrors({});
      setEditing(null);
      setFormOpen(false);
      await shifts.refetch();
    } catch (error) {
      if (error instanceof ApiError && typeof error.body === 'object' && error.body !== null) {
        const body = error.body as {
          code?: unknown;
          message?: unknown;
          shift?: { site?: { name?: unknown }; startsAt?: unknown };
        };
        if (body.code === 'SHIFT_OVERLAP') {
          setConflictingShift(
            typeof body.shift?.site?.name === 'string'
              ? body.shift.site.name
              : 'otro turno del vigilador',
          );
          setFormError('El vigilador ya tiene un turno superpuesto.');
          return;
        }
        if (body.code === 'SHIFT_STARTED') {
          setFormError('Solo se puede reasignar este turno porque ya pasó la hora de inicio.');
          return;
        }
        setFormError(
          typeof body.message === 'string' ? body.message : 'No se pudo guardar el turno.',
        );
      } else setFormError('No se pudo guardar el turno. Verificá los datos e intentá nuevamente.');
    }
  };

  const cancel = async (id: string) => {
    try {
      await apiPost(`/turnos/${id}/cancelar`, {}, emptySchema, shiftResponseSchema);
      setMessage('Turno cancelado.');
      setCancelId('');
      await shifts.refetch();
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? 'Solo se puede reasignar este turno porque ya pasó la hora de inicio.'
          : 'No se pudo cancelar el turno.',
      );
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="shifts-title">
      <h1 id="shifts-title" className="text-3xl font-semibold">
        Turnos
      </h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label>
          Predio
          <select
            className="block rounded border p-2"
            value={siteId}
            onChange={(event) => {
              setSiteId(event.target.value);
            }}
          >
            <option value="">Todos</option>
            {sites.data?.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Vigilador
          <select
            className="block rounded border p-2"
            value={guardId}
            onChange={(event) => {
              setGuardId(event.target.value);
            }}
          >
            <option value="">Todos</option>
            {guards.data?.items.map((guard) => (
              <option key={guard.id} value={guard.id}>
                {guard.firstName} {guard.lastName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Desde
          <input
            className="block rounded border p-2"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </label>
        <label>
          Hasta
          <input
            className="block rounded border p-2"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeUnassigned}
            onChange={(event) => {
              setIncludeUnassigned(event.target.checked);
            }}
          />
          Incluir turnos sin vigilador
        </label>
        <button
          type="button"
          className="rounded border px-3 py-2"
          onClick={() => {
            openForm();
          }}
        >
          Crear turno
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {shifts.isPending ? (
        <p role="status">Cargando turnos…</p>
      ) : shifts.isError ? (
        <p role="alert">No se pudieron cargar los turnos.</p>
      ) : null}
      <div className="space-y-3">
        {shifts.data?.map((shift) => {
          const assignment = shift.assignments[0];
          const guard = assignment?.guard;
          const started = Date.parse(shift.startsAt) <= now;
          return (
            <article
              key={shift.id}
              className={`space-y-2 rounded border p-4 ${shift.status === 'unassigned' ? 'border-amber-700 bg-amber-50' : ''}`}
            >
              <h2 className="font-semibold">
                {shift.site.name} ·{' '}
                {new Date(shift.serviceDate).toLocaleDateString('es-AR', { timeZone: 'UTC' })}
              </h2>
              <p>
                {formatShiftTime(shift.startsAt, shift.site.company.timezone)}–
                {formatShiftTime(shift.endsAt, shift.site.company.timezone)}
              </p>
              {guard ? (
                <p>
                  {guard.firstName} {guard.lastName}
                  {guard.status === 'invitation_pending' ? ' · invitación pendiente' : ''}
                </p>
              ) : (
                <p className="font-semibold">
                  <span aria-hidden="true">⚠ </span>Sin vigilador
                </p>
              )}
              <p>Rondas: {shift.rounds.map(({ round }) => round.name).join(', ')}</p>
              {shift.status !== 'cancelled' &&
                (started ? (
                  <p>Solo se puede reasignar (HU-44).</p>
                ) : (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        openForm(shift);
                      }}
                    >
                      {guard ? 'Editar turno' : 'Asignar vigilador'}
                    </button>
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        setCancelId(shift.id);
                      }}
                    >
                      Cancelar turno
                    </button>
                  </div>
                ))}
              {cancelId === shift.id && (
                <div
                  role="alertdialog"
                  aria-modal="true"
                  aria-label="Confirmar cancelación"
                  className="rounded border p-3"
                >
                  <p>¿Cancelar el turno de {shift.site.name}?</p>
                  <button
                    type="button"
                    className="rounded border px-3 py-2"
                    onClick={() => void cancel(shift.id)}
                  >
                    Confirmar cancelación
                  </button>
                  <button
                    type="button"
                    className="ml-2 rounded border px-3 py-2"
                    onClick={() => {
                      setCancelId('');
                    }}
                  >
                    Volver
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <ShiftFormDialog
        open={formOpen}
        form={form}
        setForm={setForm}
        sites={sites.data ?? []}
        guards={guards.data?.items ?? []}
        rounds={rounds.data ?? []}
        timezone={timezone}
        preview={preview}
        error={formError}
        fieldErrors={fieldErrors}
        conflict={conflictingShift}
        editing={editing !== null}
        onClose={() => {
          setEditing(null);
          setFormOpen(false);
        }}
        onSubmit={(event) => void save(event)}
      />
    </section>
  );
}

function ShiftFormDialog(props: {
  open: boolean;
  form: FormValues;
  setForm: (value: FormValues) => void;
  sites: z.infer<typeof sitesSchema>;
  guards: z.infer<typeof guardsSchema>['items'];
  rounds: z.infer<typeof roundsSchema>;
  timezone: string;
  preview: { expected: string[]; uncovered: string[] };
  error: string;
  fieldErrors: Record<string, string>;
  conflict: string;
  editing: boolean;
  onClose: () => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (props.open) formRef.current?.focus();
  }, [props.open]);
  if (!props.open) return null;
  const set = (patch: Partial<FormValues>) => {
    props.setForm({ ...props.form, ...patch });
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shift-form-title"
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') props.onClose();
      }}
    >
      <form
        ref={formRef}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-auto rounded bg-white p-6"
        onSubmit={props.onSubmit}
      >
        <h2 id="shift-form-title" className="text-xl font-semibold">
          {props.editing ? 'Editar turno' : 'Crear turno'}
        </h2>
        <p>Zona horaria de la empresa: {props.timezone}</p>
        <label className="grid gap-1">
          Predio
          <select
            required
            value={props.form.siteId}
            aria-label="Predio del turno"
            aria-invalid={Boolean(props.fieldErrors.siteId)}
            aria-describedby={props.fieldErrors.siteId ? 'shift-site-error' : undefined}
            onChange={(event) => {
              set({ siteId: event.target.value, roundIds: [] });
            }}
            className="rounded border p-2"
          >
            <option value="">Seleccioná un predio</option>
            {props.sites
              .filter((site) => site.status === 'active')
              .map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
          </select>
          {props.fieldErrors.siteId && (
            <span id="shift-site-error">{props.fieldErrors.siteId}</span>
          )}
        </label>
        <label className="grid gap-1">
          Vigilador
          <select
            value={props.form.guardId}
            aria-label="Vigilador del turno"
            aria-invalid={Boolean(props.fieldErrors.guardId)}
            aria-describedby={props.fieldErrors.guardId ? 'shift-guard-error' : undefined}
            onChange={(event) => {
              set({ guardId: event.target.value });
            }}
            className="rounded border p-2"
          >
            <option value="">Sin vigilador</option>
            {props.guards
              .filter((guard) => guard.status === 'active' || guard.status === 'invitation_pending')
              .map((guard) => (
                <option key={guard.id} value={guard.id}>
                  {guard.firstName} {guard.lastName}
                  {guard.status === 'invitation_pending' ? ' · invitación pendiente' : ''}
                </option>
              ))}
          </select>
          {props.fieldErrors.guardId && (
            <span id="shift-guard-error">{props.fieldErrors.guardId}</span>
          )}
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            Fecha de inicio
            <input
              required
              type="date"
              value={props.form.startDate}
              aria-invalid={Boolean(props.fieldErrors.startsAt)}
              aria-describedby={props.fieldErrors.startsAt ? 'shift-start-error' : undefined}
              onChange={(event) => {
                set({ startDate: event.target.value });
              }}
              className="rounded border p-2"
            />
            {props.fieldErrors.startsAt && (
              <span id="shift-start-error">{props.fieldErrors.startsAt}</span>
            )}
          </label>
          <label className="grid gap-1">
            Hora de inicio (24 h)
            <input
              required
              type="time"
              step="60"
              value={props.form.startTime}
              aria-invalid={Boolean(props.fieldErrors.startsAt)}
              aria-describedby={props.fieldErrors.startsAt ? 'shift-start-error' : undefined}
              onChange={(event) => {
                set({ startTime: event.target.value });
              }}
              className="rounded border p-2"
            />
          </label>
          <label className="grid gap-1">
            Fecha de fin
            <input
              required
              type="date"
              value={props.form.endDate}
              aria-invalid={Boolean(props.fieldErrors.endsAt)}
              aria-describedby={props.fieldErrors.endsAt ? 'shift-end-error' : undefined}
              onChange={(event) => {
                set({ endDate: event.target.value });
              }}
              className="rounded border p-2"
            />
            {props.fieldErrors.endsAt && (
              <span id="shift-end-error">{props.fieldErrors.endsAt}</span>
            )}
          </label>
          <label className="grid gap-1">
            Hora de fin (24 h)
            <input
              required
              type="time"
              step="60"
              value={props.form.endTime}
              aria-invalid={Boolean(props.fieldErrors.endsAt)}
              aria-describedby={props.fieldErrors.endsAt ? 'shift-end-error' : undefined}
              onChange={(event) => {
                set({ endTime: event.target.value });
              }}
              className="rounded border p-2"
            />
          </label>
        </div>
        <fieldset
          aria-invalid={Boolean(props.fieldErrors.roundIds)}
          aria-describedby={props.fieldErrors.roundIds ? 'shift-rounds-error' : undefined}
          className="space-y-2"
        >
          <legend className="font-medium">Rondas del predio</legend>
          {props.rounds
            .filter((round) => round.status === 'active')
            .map((round) => (
              <label key={round.id} className="block">
                <input
                  type="checkbox"
                  checked={props.form.roundIds.includes(round.id)}
                  onChange={(event) => {
                    set({
                      roundIds: event.target.checked
                        ? [...props.form.roundIds, round.id]
                        : props.form.roundIds.filter((id) => id !== round.id),
                    });
                  }}
                />{' '}
                {round.name}
              </label>
            ))}
          {props.fieldErrors.roundIds && (
            <p id="shift-rounds-error">{props.fieldErrors.roundIds}</p>
          )}
        </fieldset>
        <section aria-labelledby="expected-windows-title">
          <h3 id="expected-windows-title" className="font-medium">
            Ventanas esperadas del turno
          </h3>
          {props.preview.expected.length ? (
            <ul>
              {props.preview.expected.map((window, index) => (
                <li key={`${window}-${index}`}>{window}</li>
              ))}
            </ul>
          ) : (
            <p>Seleccioná fechas y rondas para calcular las ventanas.</p>
          )}
        </section>
        {props.preview.uncovered.length > 0 && (
          <p role="status">
            Advertencia: estas ventanas no quedan cubiertas por ningún turno:{' '}
            {props.preview.uncovered.join(', ')}. Podés guardar igual.
          </p>
        )}
        {props.error && (
          <p role="alert">
            {props.error}
            {props.conflict ? ` Turno en conflicto: ${props.conflict}.` : ''}
          </p>
        )}
        <div className="flex gap-3">
          <button className="rounded bg-primary px-4 py-2 text-primary-foreground">
            Guardar turno
          </button>
          <button type="button" className="rounded border px-4 py-2" onClick={props.onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}
function previousDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 2000, (month ?? 1) - 1, (day ?? 1) - 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
function formatDateTime(value: string, timezone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(value))
      .map(({ type, value: part }) => [type, part]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}
function formatShiftTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).format(new Date(value));
}
