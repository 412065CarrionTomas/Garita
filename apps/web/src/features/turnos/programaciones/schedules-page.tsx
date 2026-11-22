import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  scheduleOperationSchema,
  schedulePreviewSchema,
  shiftScheduleInputSchema,
  shiftScheduleDefinitionSchema,
  shiftScheduleExtensionSchema,
  shiftScheduleSchema,
  type ShiftScheduleInput,
  type SchedulePreview,
  type ScheduleOperation,
} from '@garita/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { loadAvailableGuards } from '../../personal/available-guards';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const sitesSchema = z.array(
  z.object({ id: z.string(), name: z.string(), company: z.object({ timezone: z.string() }) }),
);
const roundsSchema = z.array(z.object({ id: z.string(), name: z.string(), status: z.string() }));
const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
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
type Schedule = z.infer<typeof shiftScheduleSchema>;

export function WeekdaySelector({
  value,
  onChange,
}: {
  value: number[];
  onChange: (value: number[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-semibold">Días de la semana (obligatorio)</legend>
      <div className="flex flex-wrap gap-3">
        {[1, 2, 3, 4, 5, 6, 0].map((day) => (
          <Label key={day} className="min-h-12 gap-2 rounded-md border border-input px-3 py-2">
            <Checkbox
              aria-label={days[day]}
              name="weekdays"
              checked={value.includes(day)}
              onCheckedChange={(checked) =>
                onChange(checked ? [...value, day] : value.filter((item) => item !== day))
              }
              className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            {days[day]}
          </Label>
        ))}
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {value.length} días seleccionados. Los días indican cuándo comienza el turno.
      </p>
    </fieldset>
  );
}

export function SchedulePreviewTable({ preview }: { preview: SchedulePreview }) {
  const conflicts = preview.shifts.filter((shift) => shift.conflicts.length).length;
  return (
    <section aria-label="Vista previa" className="space-y-4">
      <p role="status">
        {preview.shifts.length - conflicts} turnos a generar · {conflicts} con conflicto, que no se
        generarán.
      </p>
      {preview.invitationPending && (
        <Alert variant="neutral">El vigilador tiene una invitación pendiente.</Alert>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Día de inicio</TableHead>
            <TableHead>Horario ({preview.timezone})</TableHead>
            <TableHead>Resultado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {preview.shifts.map((shift) => (
            <TableRow key={shift.serviceDate}>
              <TableCell>{shift.serviceDate}</TableCell>
              <TableCell className="tabular-nums">
                {new Date(shift.startsAt).toLocaleString('es-AR', { timeZone: preview.timezone })} —{' '}
                {new Date(shift.endsAt).toLocaleString('es-AR', { timeZone: preview.timezone })}
              </TableCell>
              <TableCell>
                {shift.conflicts.length ? (
                  <>
                    <StatusBadge tone="danger">Conflicto: no se generará</StatusBadge>
                    {shift.conflicts.map((conflict) => (
                      <p key={conflict.shiftId}>
                        Turno {conflict.shiftId}:{' '}
                        {new Date(conflict.startsAt).toLocaleString('es-AR', {
                          timeZone: preview.timezone,
                        })}{' '}
                        —{' '}
                        {new Date(conflict.endsAt).toLocaleString('es-AR', {
                          timeZone: preview.timezone,
                        })}
                      </p>
                    ))}
                  </>
                ) : (
                  <StatusBadge tone="neutral">Se generará</StatusBadge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {preview.uncoveredWindows.length > 0 && (
        <Alert variant="neutral">
          <p>Ventanas sin cubrir: {preview.uncoveredWindows.length}. Podés confirmar igualmente.</p>
          <ul>
            {preview.uncoveredWindows.map((window) => (
              <li key={`${window.roundId}:${window.startUtc}`}>
                {new Date(window.startUtc).toLocaleDateString('es-AR', {
                  timeZone: preview.timezone,
                })}{' '}
                · {window.label} · Ronda {window.roundId}
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </section>
  );
}

export function ScheduleResult({ result }: { result: ScheduleOperation }) {
  return (
    <Alert role="status">
      <p>
        Programación actualizada: {result.generated.length} turnos generados,{' '}
        {result.replaced.length} afectados y {result.conserved.length} conservados.
      </p>
      {result.conserved.length > 0 && (
        <details>
          <summary>Ver turnos conservados</summary>
          <ul>
            {result.conserved.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
        </details>
      )}
      {result.replaced.length > 0 && (
        <details>
          <summary>Ver turnos afectados</summary>
          <ul>
            {result.replaced.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
        </details>
      )}
      {result.conflicts.length > 0 && (
        <p>{result.conflicts.length} turnos no se generaron por conflicto.</p>
      )}
    </Alert>
  );
}

export function SchedulesPage() {
  const client = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState('');
  const inputSchema = editingId ? shiftScheduleDefinitionSchema : shiftScheduleInputSchema;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const [action, setAction] = useState<{ schedule: Schedule; kind: 'extend' | 'cancel' } | null>(
    null,
  );
  const [extensionEnd, setExtensionEnd] = useState('');
  const schedules = useQuery({
    queryKey: ['programaciones-turnos'],
    queryFn: () => apiGet('/programaciones-turnos', z.array(shiftScheduleSchema)),
  });
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
    setError(failure instanceof Error ? failure.message : 'No se pudo completar la operación');
    requestAnimationFrame(() => errorRef.current?.focus());
  };
  const preview = useMutation({
    mutationFn: (input: ShiftScheduleInput) =>
      apiPost(
        `/programaciones-turnos/previsualizar${editingId ? `?programacion=${encodeURIComponent(editingId)}` : ''}`,
        input,
        inputSchema,
        schedulePreviewSchema,
      ),
    onError: fail,
  });
  const save = useMutation({
    mutationFn: (input: ShiftScheduleInput) =>
      editingId
        ? apiPatch(
            `/programaciones-turnos/${editingId}`,
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
    onSuccess: async () => {
      setOpen(false);
      preview.reset();
      await client.invalidateQueries({ queryKey: ['programaciones-turnos'] });
      await client.invalidateQueries({ queryKey: ['turnos'] });
    },
    onError: fail,
  });
  const change = useMutation({
    mutationFn: async () => {
      if (!action) throw new Error('Elegí una programación');
      return apiPost(
        `/programaciones-turnos/${action.schedule.id}/${action.kind === 'extend' ? 'extender' : 'cancelar'}`,
        action.kind === 'extend' ? { endDate: extensionEnd } : {},
        action.kind === 'extend' ? shiftScheduleExtensionSchema : z.strictObject({}),
        scheduleOperationSchema,
      );
    },
    onSuccess: async () => {
      setAction(null);
      await client.invalidateQueries({ queryKey: ['programaciones-turnos'] });
      await client.invalidateQueries({ queryKey: ['turnos'] });
    },
    onError: fail,
  });
  const set = (patch: Partial<ShiftScheduleInput>) => {
    setForm((previous) => ({ ...previous, ...patch }));
    preview.reset();
    setError('');
  };
  const edit = (schedule?: Schedule) => {
    if (schedule) {
      const { id, status: _status, ...values } = schedule;
      const zone = sites.data?.find((site) => site.id === values.siteId)?.company.timezone;
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
      setForm({ ...values, startDate: values.startDate < today ? today : values.startDate });
      setEditingId(id);
    } else {
      setForm(emptyForm);
      setEditingId('');
    }
    setError('');
    preview.reset();
    save.reset();
    change.reset();
    setOpen(true);
  };
  const pending = save.isPending || preview.isPending || change.isPending;
  const parsedForm = inputSchema.safeParse(form);
  return (
    <main className="space-y-6 p-6">
      <PageHeader
        title="Programaciones de turnos"
        description="Guardias semanales en el horario local de la empresa. Feriados y esquemas rotativos se cargan como turnos individuales."
        actions={<Button onClick={() => edit()}>Nueva programación</Button>}
      />
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
      {save.data && <ScheduleResult result={save.data} />}
      {change.data && <ScheduleResult result={change.data} />}
      {schedules.isPending && <p role="status">Cargando programaciones…</p>}
      {schedules.isError && (
        <Alert>
          No se pudieron cargar las programaciones.{' '}
          <Button variant="outline" onClick={() => void schedules.refetch()}>
            Reintentar
          </Button>
        </Alert>
      )}
      {sites.isError || guards.isError || rounds.isError ? (
        <Alert>
          No se pudieron cargar las opciones del formulario.{' '}
          <Button
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
      ) : null}
      {schedules.data?.length === 0 && (
        <EmptyState
          title="Sin programaciones vigentes"
          description="Creá una programación para repetir una guardia semanal."
        />
      )}
      {!!schedules.data?.length && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Predio y vigilador</TableHead>
              <TableHead>Días y horario</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedules.data.map((schedule) => (
              <TableRow key={schedule.id}>
                <TableCell>
                  {sites.data?.find((site) => site.id === schedule.siteId)?.name ?? 'Predio'}
                  <p className="text-muted-foreground">
                    {guards.data?.items.find((guard) => guard.id === schedule.guardId)?.firstName ??
                      'Vigilador'}{' '}
                    {guards.data?.items.find((guard) => guard.id === schedule.guardId)?.lastName}
                  </p>
                </TableCell>
                <TableCell>
                  {schedule.weekdays.map((day) => days[day]).join(', ')}
                  <p className="tabular-nums">
                    {schedule.startTime} — {schedule.endTime}
                  </p>
                </TableCell>
                <TableCell>
                  {schedule.startDate} al {schedule.endDate}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => edit(schedule)}>
                      Modificar
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setAction({ schedule, kind: 'extend' });
                        setExtensionEnd('');
                        setError('');
                      }}
                    >
                      Extender
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setAction({ schedule, kind: 'cancel' });
                        setError('');
                      }}
                    >
                      Cancelar programación
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {open && (
        <section
          aria-labelledby="schedule-form-title"
          className="space-y-4 rounded-md border border-border bg-card p-6"
        >
          <h2 id="schedule-form-title" className="t-headline">
            {editingId ? 'Modificar programación' : 'Nueva programación'}
          </h2>
          <form
            aria-labelledby="schedule-form-title"
            onSubmit={(event) => {
              event.preventDefault();
              setError('');
              const parsed = inputSchema.safeParse(form);
              if (!parsed.success) {
                fail(new Error(parsed.error.issues[0]?.message ?? 'Revisá los campos'));
                return;
              }
              preview.mutate(parsed.data);
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="schedule-site">Predio (obligatorio)</Label>
                <NativeSelect
                  id="schedule-site"
                  name="siteId"
                  required
                  value={form.siteId}
                  onChange={(event) => set({ siteId: event.target.value, roundIds: [] })}
                >
                  <NativeSelectOption value="">Elegí un predio</NativeSelectOption>
                  {sites.data?.map((site) => (
                    <NativeSelectOption key={site.id} value={site.id}>
                      {site.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-guard">Vigilador (obligatorio)</Label>
                <NativeSelect
                  id="schedule-guard"
                  name="guardId"
                  required
                  value={form.guardId}
                  onChange={(event) => set({ guardId: event.target.value })}
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
            <WeekdaySelector value={form.weekdays} onChange={(weekdays) => set({ weekdays })} />
            <div className="grid gap-4 md:grid-cols-2">
              {(['startTime', 'endTime', 'startDate', 'endDate'] as const).map((key) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={`schedule-${key}`}>
                    {
                      {
                        startTime: 'Hora de inicio',
                        endTime: 'Hora de fin',
                        startDate: 'Fecha inicial',
                        endDate: 'Fecha final incluida',
                      }[key]
                    }{' '}
                    (obligatorio)
                  </Label>
                  <Input
                    id={`schedule-${key}`}
                    name={key}
                    type={key.endsWith('Time') ? 'time' : 'date'}
                    required
                    value={form[key]}
                    onChange={(event) => set({ [key]: event.target.value })}
                  />
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Hasta tres meses de calendario por período. Si la hora de fin es anterior o igual al
              inicio, el turno termina al día siguiente.
            </p>
            <fieldset className="space-y-2">
              <legend className="font-semibold">Rondas (al menos una)</legend>
              {rounds.data
                ?.filter((round) => round.status === 'active')
                .map((round) => (
                  <Label key={round.id} className="min-h-12 gap-2">
                    <Checkbox
                      name="roundIds"
                      aria-label={round.name}
                      checked={form.roundIds.includes(round.id)}
                      onCheckedChange={(checked) =>
                        set({
                          roundIds: checked
                            ? [...form.roundIds, round.id]
                            : form.roundIds.filter((id) => id !== round.id),
                        })
                      }
                      className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    {round.name}
                  </Label>
                ))}
            </fieldset>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {preview.isPending ? 'Previsualizando…' : 'Previsualizar'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cerrar formulario
              </Button>
            </div>
          </form>
          {preview.data &&
            parsedForm.success &&
            JSON.stringify(parsedForm.data) === JSON.stringify(preview.variables) && (
              <>
                <SchedulePreviewTable preview={preview.data} />
                <Button disabled={pending} onClick={() => save.mutate(parsedForm.data)}>
                  {save.isPending
                    ? 'Confirmando…'
                    : editingId
                      ? 'Confirmar modificación'
                      : 'Confirmar programación'}
                </Button>
              </>
            )}
        </section>
      )}
      <Dialog
        open={Boolean(action)}
        onOpenChange={(value) => {
          if (!value) setAction(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {action?.kind === 'extend' ? 'Extender programación' : 'Cancelar programación'}
          </DialogTitle>
          <DialogDescription>
            {action?.kind === 'extend'
              ? `Se agregarán turnos desde el día siguiente a ${action.schedule.endDate}, hasta tres meses adicionales.`
              : 'Se cancelarán los turnos futuros sin iniciar. Los turnos realizados se conservarán.'}
          </DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              change.mutate();
            }}
            className="space-y-4"
          >
            {action?.kind === 'extend' && (
              <>
                <Label htmlFor="extension-end">Nueva fecha final incluida</Label>
                <Input
                  id="extension-end"
                  name="endDate"
                  type="date"
                  required
                  value={extensionEnd}
                  onChange={(event) => setExtensionEnd(event.target.value)}
                />
              </>
            )}
            {error && <Alert>{error}</Alert>}
            <Button type="submit" disabled={pending}>
              {change.isPending ? 'Confirmando…' : 'Confirmar'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
