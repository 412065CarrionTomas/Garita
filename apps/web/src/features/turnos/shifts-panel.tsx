import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { apiGet, apiPost } from '@/lib/api-client';

const shiftRowsSchema = z.array(
  z.looseObject({
    id: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    serviceDate: z.string(),
    status: z.enum(['scheduled', 'unassigned', 'cancelled']),
    site: z.looseObject({ name: z.string(), company: z.looseObject({ timezone: z.string() }) }),
    assignments: z.array(
      z.looseObject({
        guard: z
          .looseObject({ firstName: z.string(), lastName: z.string(), status: z.string() })
          .nullable(),
      }),
    ),
    rounds: z.array(z.looseObject({ round: z.looseObject({ name: z.string() }) })),
  }),
);

const emptySchema = z.object({});
const responseSchema = z.looseObject({ id: z.string() });

export function ShiftsPanel() {
  const [siteId, setSiteId] = useState('');
  const [guardId, setGuardId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeUnassigned, setIncludeUnassigned] = useState(true);
  const [confirmId, setConfirmId] = useState('');
  const [message, setMessage] = useState('');
  const query = new URLSearchParams();
  if (siteId) query.set('predio', siteId);
  if (guardId) query.set('vigilador', guardId);
  if (from) query.set('desde', new Date(`${from}T00:00:00`).toISOString());
  if (to) query.set('hasta', new Date(`${to}T23:59:59`).toISOString());
  if (!includeUnassigned) query.set('sinVigilador', 'false');
  const shifts = useQuery({
    queryKey: ['turnos', siteId, guardId, from, to, includeUnassigned],
    queryFn: async () => {
      const rows = await apiGet(`/turnos?${query.toString()}`, shiftRowsSchema);
      const asOf = Date.now();
      return rows.map((shift) => ({ ...shift, started: Date.parse(shift.startsAt) <= asOf }));
    },
  });
  const sites = useQuery({
    queryKey: ['predios', 'activos'],
    queryFn: () =>
      apiGet(
        '/predios?estado=active',
        z.array(z.looseObject({ id: z.string(), name: z.string() })),
      ),
  });
  const guards = useQuery({
    queryKey: ['personal', 'vigiladores'],
    queryFn: () =>
      apiGet(
        '/usuarios?rol=guard&pagina=1',
        z.looseObject({
          items: z.array(
            z.looseObject({
              id: z.string(),
              firstName: z.string(),
              lastName: z.string(),
              status: z.string(),
            }),
          ),
        }),
      ),
  });
  const cancel = async (id: string) => {
    try {
      await apiPost(`/turnos/${id}/cancelar`, {}, emptySchema, responseSchema);
      setMessage('Turno cancelado.');
      setConfirmId('');
      await shifts.refetch();
    } catch {
      setMessage('No se pudo cancelar el turno. Si ya comenzó, solo se puede reasignar.');
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
          const started = shift.started;
          return (
            <article key={shift.id} className="space-y-2 rounded border p-4">
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
                <p className="font-semibold" aria-label="Turno sin vigilador">
                  ⚠ Sin vigilador
                </p>
              )}
              <p>Rondas: {shift.rounds.map(({ round }) => round.name).join(', ')}</p>
              {shift.status !== 'cancelled' &&
                (started ? (
                  <p>Solo se puede reasignar (HU-44).</p>
                ) : (
                  <button
                    className="rounded border px-3 py-2 underline"
                    onClick={() => {
                      setConfirmId(shift.id);
                    }}
                  >
                    Cancelar turno
                  </button>
                ))}
              {confirmId === shift.id && (
                <div role="alertdialog" aria-label="Confirmar cancelación">
                  <p>¿Cancelar el turno de {shift.site.name}?</p>
                  <button
                    className="rounded border px-3 py-2"
                    onClick={() => {
                      void cancel(shift.id);
                    }}
                  >
                    Confirmar
                  </button>
                  <button
                    className="ml-2 rounded border px-3 py-2"
                    onClick={() => {
                      setConfirmId('');
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
    </section>
  );
}

function formatShiftTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).format(new Date(value));
}
