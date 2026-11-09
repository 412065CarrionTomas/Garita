import {
  computeRoundWindows,
  SHIFT_EXECUTION_STATUSES,
  findUncoveredWindows,
  localDateTimeToUtc,
  shiftInputSchema,
  windowsForShift,
} from '@garita/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { z } from 'zod';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api-client';

import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SegmentedFilter } from '@/components/segmented-filter';
import { Stamp } from '@/components/stamp';
import { StatusBadge } from '@/components/status-badge';
import { WindowBar } from '@/components/window-bar';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const shiftRowsSchema = z.array(
  z.looseObject({
    id: z.string(),
    siteId: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    serviceDate: z.string(),
    status: z.enum(['scheduled', 'unassigned', 'cancelled', ...SHIFT_EXECUTION_STATUSES]),
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
// En curso lleva tilde; programado y cancelado, recuadro punteado; lo cerrado va en tinta.
const shiftStates = {
  scheduled: { label: 'Programado', tone: 'neutral' },
  unassigned: { label: 'Sin asignar', tone: 'warning' },
  in_progress: { label: 'En curso', tone: 'success' },
  closed: { label: 'Cerrado', tone: 'info' },
  auto_closed: { label: 'Cerrado por el sistema', tone: 'warning' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
} as const;

type StateFilter = 'all' | 'curso' | 'prog' | 'fin' | 'canc';
const stateFilters: { value: StateFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'curso', label: 'En curso' },
  { value: 'prog', label: 'Programados' },
  { value: 'fin', label: 'Finalizados' },
  { value: 'canc', label: 'Cancelados' },
];
const filterStatuses: Record<Exclude<StateFilter, 'all'>, readonly Shift['status'][]> = {
  curso: ['in_progress'],
  prog: ['scheduled', 'unassigned'],
  fin: ['closed', 'auto_closed'],
  canc: ['cancelled'],
};

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
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
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
  const visibleShifts = (shifts.data ?? []).filter(
    (shift) => stateFilter === 'all' || filterStatuses[stateFilter].includes(shift.status),
  );
  const windowCounts = useMemo(
    () => new Map((shifts.data ?? []).map((shift) => [shift.id, expectedWindowCount(shift)])),
    [shifts.data],
  );
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
        // La cobertura solo distingue los turnos cancelados.
        status: shift.status === 'cancelled' ? ('cancelled' as const) : undefined,
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
    <section className="space-y-6" aria-labelledby="shifts-title">
      <PageHeader
        id="shifts-title"
        title="Turnos"
        description={`${longDate(now)}. Organizá los horarios, vigiladores y rondas de cada predio.`}
        actions={
          <Button
            onClick={() => {
              openForm();
            }}
          >
            Nuevo turno
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Label className="grid min-w-0 gap-2">
          Predio
          <NativeSelect
            className="w-full"
            value={siteId}
            onChange={(event) => {
              setSiteId(event.target.value);
            }}
          >
            <NativeSelectOption value="">Todos</NativeSelectOption>
            {sites.data?.map((site) => (
              <NativeSelectOption key={site.id} value={site.id}>
                {site.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
        <Label className="grid min-w-0 gap-2">
          Vigilador
          <NativeSelect
            className="w-full"
            value={guardId}
            onChange={(event) => {
              setGuardId(event.target.value);
            }}
          >
            <NativeSelectOption value="">Todos</NativeSelectOption>
            {guards.data?.items.map((guard) => (
              <NativeSelectOption key={guard.id} value={guard.id}>
                {guard.firstName} {guard.lastName}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
        <Label className="grid min-w-0 gap-2">
          Desde
          <Input
            className="w-full"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </Label>
        <Label className="grid min-w-0 gap-2">
          Hasta
          <Input
            className="w-full"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </Label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeUnassigned}
            onChange={(event) => {
              setIncludeUnassigned(event.target.checked);
            }}
          />
          Incluir turnos sin vigilador
        </Label>
      </div>
      <SegmentedFilter
        ariaLabel="Filtrar turnos por estado"
        options={stateFilters}
        value={stateFilter}
        onChange={setStateFilter}
      />
      {message && <p role="status">{message}</p>}
      {shifts.isPending ? (
        <div role="status" aria-label="Cargando turnos" className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : shifts.isError ? (
        <Alert variant="destructive">
          No se pudieron cargar los turnos.{' '}
          <Button type="button" variant="outline" size="sm" onClick={() => void shifts.refetch()}>
            Reintentar
          </Button>
        </Alert>
      ) : visibleShifts.length === 0 ? (
        <EmptyState
          title="Sin turnos en este estado"
          description="Probá con otro filtro o creá un turno nuevo."
        />
      ) : (
        <Table aria-label="Turnos">
          <TableHeader>
            <TableRow>
              <TableHead>Predio</TableHead>
              <TableHead>Vigilador</TableHead>
              <TableHead>Ronda</TableHead>
              <TableHead>Horario</TableHead>
              <TableHead>Ventanas</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleShifts.flatMap((shift) => {
              const guard = shift.assignments[0]?.guard;
              const started = Date.parse(shift.startsAt) <= now;
              const cancelled = shift.status === 'cancelled';
              const windowCount = windowCounts.get(shift.id) ?? 0;
              const rows = [
                <TableRow
                  key={shift.id}
                  className={cn(
                    shift.status === 'unassigned' && 'bg-warning-soft',
                    cancelled && 'text-muted-foreground',
                  )}
                >
                  <TableCell>
                    <b className={cn('block font-semibold', cancelled && 'line-through')}>
                      {shift.site.name}
                    </b>
                    <small className="block tabular-nums text-muted-foreground">
                      {new Date(shift.serviceDate).toLocaleDateString('es-AR', { timeZone: 'UTC' })}
                    </small>
                  </TableCell>
                  <TableCell>
                    {guard ? (
                      <span>
                        {guard.firstName} {guard.lastName}
                        {guard.status === 'invitation_pending' ? ' · invitación pendiente' : ''}
                      </span>
                    ) : (
                      <Stamp variant="late">Sin vigilador</Stamp>
                    )}
                  </TableCell>
                  <TableCell>{shift.rounds.map(({ round }) => round.name).join(', ')}</TableCell>
                  <TableCell className="t-numeral">
                    {formatShiftTime(shift.startsAt, shift.site.company.timezone)}–
                    {formatShiftTime(shift.endsAt, shift.site.company.timezone)}
                  </TableCell>
                  <TableCell>
                    {windowCount === 0 || cancelled ? (
                      <span className="text-muted-foreground">—</span>
                    ) : shift.status === 'scheduled' || shift.status === 'unassigned' ? (
                      <WindowBar
                        windows={Array.from({ length: windowCount }, () => ({
                          status: 'pending' as const,
                        }))}
                      />
                    ) : (
                      // TODO(foja): el listado no trae el estado de cada ventana; solo se muestra la cantidad.
                      <span className="tabular-nums">{windowCount} ventanas</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={shiftStates[shift.status].tone}>
                      {shiftStates[shift.status].label}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>
                    {!cancelled &&
                      (started ? (
                        <span className="text-sm">Solo se puede reasignar (HU-44).</span>
                      ) : (
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              openForm(shift);
                            }}
                          >
                            {guard ? 'Editar turno' : 'Asignar vigilador'}
                          </Button>
                          <Button
                            type="button"
                            variant="ghostDestructive"
                            size="sm"
                            onClick={() => {
                              setCancelId(shift.id);
                            }}
                          >
                            Cancelar turno
                          </Button>
                        </div>
                      ))}
                  </TableCell>
                </TableRow>,
              ];
              if (cancelId === shift.id)
                rows.push(
                  <TableRow key={`${shift.id}-cancel`}>
                    <TableCell colSpan={7} className="whitespace-normal">
                      <Alert
                        role="alertdialog"
                        aria-modal="true"
                        aria-label="Confirmar cancelación"
                        className="space-y-3 border-warning bg-warning-soft text-warning"
                      >
                        <p>¿Cancelar el turno de {shift.site.name}?</p>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void cancel(shift.id)}
                          >
                            Confirmar cancelación
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setCancelId('');
                            }}
                          >
                            Volver
                          </Button>
                        </div>
                      </Alert>
                    </TableCell>
                  </TableRow>,
                );
              return rows;
            })}
          </TableBody>
        </Table>
      )}
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
  const set = (patch: Partial<FormValues>) => {
    props.setForm({ ...props.form, ...patch });
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent aria-labelledby="shift-form-title" aria-describedby="shift-form-description">
        <form className="space-y-4" onSubmit={props.onSubmit}>
          <DialogTitle id="shift-form-title">
            {props.editing ? 'Editar turno' : 'Nuevo turno'}
          </DialogTitle>
          <DialogDescription id="shift-form-description" className="tabular-nums">
            Zona horaria de la empresa: {props.timezone}
          </DialogDescription>
          <Label className="grid gap-1">
            Predio
            <NativeSelect
              required
              value={props.form.siteId}
              aria-label="Predio del turno"
              aria-invalid={Boolean(props.fieldErrors.siteId)}
              aria-describedby={props.fieldErrors.siteId ? 'shift-site-error' : undefined}
              onChange={(event) => {
                set({ siteId: event.target.value, roundIds: [] });
              }}
              className="w-full"
            >
              <NativeSelectOption value="">Seleccioná un predio</NativeSelectOption>
              {props.sites
                .filter((site) => site.status === 'active')
                .map((site) => (
                  <NativeSelectOption key={site.id} value={site.id}>
                    {site.name}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
            {props.fieldErrors.siteId && (
              <span className="text-sm text-danger" id="shift-site-error">
                {props.fieldErrors.siteId}
              </span>
            )}
          </Label>
          <Label className="grid gap-1">
            Vigilador
            <NativeSelect
              value={props.form.guardId}
              aria-label="Vigilador del turno"
              aria-invalid={Boolean(props.fieldErrors.guardId)}
              aria-describedby={props.fieldErrors.guardId ? 'shift-guard-error' : undefined}
              onChange={(event) => {
                set({ guardId: event.target.value });
              }}
              className="w-full"
            >
              <NativeSelectOption value="">Sin vigilador</NativeSelectOption>
              {props.guards
                .filter(
                  (guard) => guard.status === 'active' || guard.status === 'invitation_pending',
                )
                .map((guard) => (
                  <NativeSelectOption key={guard.id} value={guard.id}>
                    {guard.firstName} {guard.lastName}
                    {guard.status === 'invitation_pending' ? ' · invitación pendiente' : ''}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
            {props.fieldErrors.guardId && (
              <span className="text-sm text-danger" id="shift-guard-error">
                {props.fieldErrors.guardId}
              </span>
            )}
          </Label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label className="grid gap-1">
              Fecha de inicio
              <Input
                required
                type="date"
                value={props.form.startDate}
                aria-invalid={Boolean(props.fieldErrors.startsAt)}
                aria-describedby={props.fieldErrors.startsAt ? 'shift-start-error' : undefined}
                onChange={(event) => {
                  set({ startDate: event.target.value });
                }}
                className="w-full"
              />
              {props.fieldErrors.startsAt && (
                <span className="text-sm text-danger" id="shift-start-error">
                  {props.fieldErrors.startsAt}
                </span>
              )}
            </Label>
            <Label className="grid gap-1">
              Hora de inicio (24 h)
              <Input
                required
                type="time"
                step="60"
                value={props.form.startTime}
                aria-invalid={Boolean(props.fieldErrors.startsAt)}
                aria-describedby={props.fieldErrors.startsAt ? 'shift-start-error' : undefined}
                onChange={(event) => {
                  set({ startTime: event.target.value });
                }}
                className="w-full"
              />
            </Label>
            <Label className="grid gap-1">
              Fecha de fin
              <Input
                required
                type="date"
                value={props.form.endDate}
                aria-invalid={Boolean(props.fieldErrors.endsAt)}
                aria-describedby={props.fieldErrors.endsAt ? 'shift-end-error' : undefined}
                onChange={(event) => {
                  set({ endDate: event.target.value });
                }}
                className="w-full"
              />
              {props.fieldErrors.endsAt && (
                <span className="text-sm text-danger" id="shift-end-error">
                  {props.fieldErrors.endsAt}
                </span>
              )}
            </Label>
            <Label className="grid gap-1">
              Hora de fin (24 h)
              <Input
                required
                type="time"
                step="60"
                value={props.form.endTime}
                aria-invalid={Boolean(props.fieldErrors.endsAt)}
                aria-describedby={props.fieldErrors.endsAt ? 'shift-end-error' : undefined}
                onChange={(event) => {
                  set({ endTime: event.target.value });
                }}
                className="w-full"
              />
            </Label>
          </div>
          <fieldset
            aria-invalid={Boolean(props.fieldErrors.roundIds)}
            aria-describedby={props.fieldErrors.roundIds ? 'shift-rounds-error' : undefined}
            className="space-y-2"
          >
            <legend className="t-label mb-1 text-muted-foreground">Rondas del predio</legend>
            {props.rounds
              .filter((round) => round.status === 'active')
              .map((round) => (
                <Label key={round.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={props.form.roundIds.includes(round.id)}
                    onChange={(event) => {
                      set({
                        roundIds: event.target.checked
                          ? [...props.form.roundIds, round.id]
                          : props.form.roundIds.filter((id) => id !== round.id),
                      });
                    }}
                  />
                  {round.name}
                </Label>
              ))}
            {props.fieldErrors.roundIds && (
              <p className="text-sm text-danger" id="shift-rounds-error">
                {props.fieldErrors.roundIds}
              </p>
            )}
          </fieldset>
          <section aria-labelledby="expected-windows-title">
            <h3 id="expected-windows-title" className="t-label mb-1 text-muted-foreground">
              Ventanas esperadas del turno
            </h3>
            {props.preview.expected.length ? (
              <ul className="flex flex-wrap gap-2">
                {props.preview.expected.map((window, index) => (
                  <li key={`${window}-${index}`}>
                    <Stamp>{window}</Stamp>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Seleccioná fechas y rondas para calcular las ventanas.
              </p>
            )}
          </section>
          {props.preview.uncovered.length > 0 && (
            <Alert role="status" className="border-warning bg-warning-soft text-warning">
              Advertencia: estas ventanas no quedan cubiertas por ningún turno:{' '}
              {props.preview.uncovered.join(', ')}. Podés guardar igual.
            </Alert>
          )}
          {props.error && (
            <Alert variant="destructive">
              {props.error}
              {props.conflict ? ` Turno en conflicto: ${props.conflict}.` : ''}
            </Alert>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit">Guardar turno</Button>
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancelar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function longDate(value: number): string {
  const text = new Date(value)
    .toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    .replace(',', '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
/** Ventanas de sus rondas que terminan dentro del turno (misma cuenta que la vista previa del formulario). */
function expectedWindowCount(shift: Shift): number {
  const timezone = shift.site.company.timezone;
  const startDate = formatDateTime(shift.startsAt, timezone).date;
  return shift.rounds.reduce((total, { round }) => {
    const version = round.currentVersion;
    if (!version) return total;
    const windows = [previousDate(startDate), startDate].flatMap((date) =>
      computeRoundWindows(date, { ...version, timezone }),
    );
    return (
      total +
      windowsForShift(windows, { shiftStartUtc: shift.startsAt, shiftEndUtc: shift.endsAt })
        .endingInShift.length
    );
  }, 0);
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
