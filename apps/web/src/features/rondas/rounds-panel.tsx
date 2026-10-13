import { useQuery } from '@tanstack/react-query';
import { defaultGraceMinutes, previewWindows, roundInputSchema } from '@garita/shared';
import { useState } from 'react';
import { z } from 'zod';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';

const checkpointsSchema = z.array(z.looseObject({ id: z.string(), name: z.string() }));
const roundsSchema = z.array(
  z.looseObject({
    id: z.string(),
    name: z.string(),
    status: z.enum(['active', 'inactive']),
    currentVersion: z
      .looseObject({
        frequencyMinutes: z.number(),
        windowStartLocal: z.string(),
        windowEndLocal: z.string(),
        graceMinutes: z.number(),
        checkpoints: z.array(
          z.looseObject({
            position: z.number(),
            checkpoint: z.looseObject({ id: z.string(), name: z.string() }),
          }),
        ),
      })
      .nullable(),
  }),
);
const idSchema = z.looseObject({ id: z.string() });

export function RoundsPanel({ site }: { site: { id: string; status: 'active' | 'inactive' } }) {
  const { user } = useAuth();
  const canWrite = user?.role === 'admin' || user?.role === 'supervisor';
  const rounds = useQuery({
    queryKey: ['rondas', site.id],
    queryFn: () => apiGet(`/predios/${site.id}/rondas`, roundsSchema),
  });
  const points = useQuery({
    queryKey: ['puntos', site.id],
    queryFn: () => apiGet(`/predios/${site.id}/puntos`, checkpointsSchema),
  });
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState(120);
  const [start, setStart] = useState('22:00');
  const [end, setEnd] = useState('06:00');
  const [grace, setGrace] = useState(15);
  const [selected, setSelected] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string>();
  const [confirmId, setConfirmId] = useState<string>();
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const labels = previewWindows({
    windowStartLocal: start,
    windowEndLocal: end,
    frequencyMinutes: frequency,
  });
  const save = async () => {
    const parsed = roundInputSchema.safeParse({
      name,
      checkpointIds: selected,
      frequencyMinutes: frequency,
      windowStartLocal: start,
      windowEndLocal: end,
      graceMinutes: grace,
    });
    if (!parsed.success) {
      const nextErrors = parsed.error.issues.reduce<Record<string, string[]>>((errors, issue) => {
        const field = String(issue.path[0] ?? 'form');
        errors[field] = [...(errors[field] ?? []), issue.message];
        return errors;
      }, {});
      setFieldErrors(nextErrors);
      setMessage('');
      return;
    }
    setFieldErrors({});
    try {
      if (editingId)
        await apiPatch(`/rondas/${editingId}`, parsed.data, roundInputSchema, idSchema);
      else await apiPost(`/predios/${site.id}/rondas`, parsed.data, roundInputSchema, idSchema);
      setMessage(
        editingId
          ? 'Ronda actualizada. Los cambios aplican a los turnos futuros.'
          : 'Ronda creada.',
      );
      setEditingId(undefined);
      await rounds.refetch();
    } catch {
      setMessage('No se pudo guardar la ronda. Verificá los puntos y el nombre.');
    }
  };
  return (
    <section className="mt-4 space-y-3 rounded border p-4" aria-labelledby={`rounds-${site.id}`}>
      <h3 id={`rounds-${site.id}`} className="text-lg font-semibold">
        Rondas
      </h3>
      {rounds.isPending ? (
        <p role="status">Cargando rondas…</p>
      ) : (
        rounds.data?.map((round) => (
          <article key={round.id} className="rounded border p-3">
            <h4 className="font-medium">{round.name}</h4>
            <p>
              {round.currentVersion?.windowStartLocal}–{round.currentVersion?.windowEndLocal} · cada{' '}
              {round.currentVersion?.frequencyMinutes} min
            </p>
            <ol>
              {round.currentVersion?.checkpoints.map(({ checkpoint }) => (
                <li key={checkpoint.id}>{checkpoint.name}</li>
              ))}
            </ol>
            {round.status === 'active' && canWrite && (
              <div className="flex gap-2">
                <button
                  className="underline"
                  onClick={() => {
                    setEditingId(round.id);
                    setName(round.name);
                    setFrequency(round.currentVersion?.frequencyMinutes ?? 120);
                    setStart(round.currentVersion?.windowStartLocal ?? '22:00');
                    setEnd(round.currentVersion?.windowEndLocal ?? '06:00');
                    setGrace(round.currentVersion?.graceMinutes ?? 15);
                    setSelected(
                      round.currentVersion?.checkpoints.map(({ checkpoint }) => checkpoint.id) ??
                        [],
                    );
                  }}
                >
                  Editar
                </button>
                <button
                  className="underline"
                  onClick={() => {
                    setConfirmId(round.id);
                  }}
                >
                  Dar de baja
                </button>
              </div>
            )}
            {confirmId === round.id && (
              <div role="alertdialog" aria-label="Confirmar baja">
                <p>¿Dar de baja {round.name}?</p>
                <button
                  onClick={() => {
                    void apiPost(`/rondas/${round.id}/baja`, {}, z.object({}), idSchema).then(() =>
                      rounds.refetch(),
                    );
                    setConfirmId(undefined);
                  }}
                >
                  Confirmar baja
                </button>
                <button
                  onClick={() => {
                    setConfirmId(undefined);
                  }}
                >
                  Cancelar
                </button>
              </div>
            )}
          </article>
        ))
      )}
      {canWrite && site.status === 'active' && (
        <form
          className="grid gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h4>{editingId ? 'Editar ronda' : 'Nueva ronda'}</h4>
          <label htmlFor="round-name">
            Nombre
            <input
              id="round-name"
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? 'round-name-error' : undefined}
              className="ml-2 rounded border p-1"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              required
            />
          </label>
          {fieldErrors.name?.map((error) => (
            <p id="round-name-error" key={error}>
              {error}
            </p>
          ))}
          <label htmlFor="round-frequency">
            Frecuencia (minutos)
            <input
              id="round-frequency"
              aria-invalid={Boolean(fieldErrors.frequencyMinutes)}
              aria-describedby={fieldErrors.frequencyMinutes ? 'round-frequency-error' : undefined}
              className="ml-2 rounded border p-1"
              type="number"
              min="15"
              max="1440"
              value={frequency}
              onChange={(event) => {
                const next = Number(event.target.value);
                setFrequency(next);
                setGrace(defaultGraceMinutes(next));
              }}
            />
          </label>
          {fieldErrors.frequencyMinutes?.map((error) => (
            <p id="round-frequency-error" key={error}>
              {error}
            </p>
          ))}
          <label htmlFor="round-start">
            Inicio de franja
            <input
              id="round-start"
              aria-invalid={Boolean(fieldErrors.windowStartLocal)}
              aria-describedby={fieldErrors.windowStartLocal ? 'round-start-error' : undefined}
              className="ml-2 rounded border p-1"
              type="time"
              value={start}
              onChange={(event) => {
                setStart(event.target.value);
              }}
            />
          </label>
          {fieldErrors.windowStartLocal?.map((error) => (
            <p id="round-start-error" key={error}>
              {error}
            </p>
          ))}
          <label htmlFor="round-end">
            Fin de franja
            <input
              id="round-end"
              aria-invalid={Boolean(fieldErrors.windowEndLocal)}
              aria-describedby={fieldErrors.windowEndLocal ? 'round-end-error' : undefined}
              className="ml-2 rounded border p-1"
              type="time"
              value={end}
              onChange={(event) => {
                setEnd(event.target.value);
              }}
            />
          </label>
          {fieldErrors.windowEndLocal?.map((error) => (
            <p id="round-end-error" key={error}>
              {error}
            </p>
          ))}
          {start === end && <p>Todo el día (24 h)</p>}
          <label htmlFor="round-grace">
            Gracia (minutos; predeterminada {defaultGraceMinutes(frequency)}, máximo{' '}
            {Math.min(60, frequency / 2)})
            <input
              id="round-grace"
              aria-invalid={Boolean(fieldErrors.graceMinutes)}
              aria-describedby={fieldErrors.graceMinutes ? 'round-grace-error' : undefined}
              className="ml-2 rounded border p-1"
              type="number"
              min="0"
              max="60"
              value={grace}
              onChange={(event) => {
                setGrace(Number(event.target.value));
              }}
            />
          </label>
          {fieldErrors.graceMinutes?.map((error) => (
            <p id="round-grace-error" key={error}>
              {error}
            </p>
          ))}
          <fieldset>
            <legend>Puntos en orden de recorrido</legend>
            {fieldErrors.checkpointIds?.map((error) => (
              <p id="round-checkpoints-error" key={error}>
                {error}
              </p>
            ))}
            {points.data?.map((point) => (
              <label key={point.id} className="block">
                <input
                  type="checkbox"
                  checked={selected.includes(point.id)}
                  onChange={(event) => {
                    setSelected(
                      event.target.checked
                        ? [...selected, point.id]
                        : selected.filter((id) => id !== point.id),
                    );
                  }}
                />{' '}
                {point.name}
              </label>
            ))}
          </fieldset>
          <ol
            aria-label="Orden de puntos"
            onDragOver={(event) => {
              event.preventDefault();
            }}
          >
            {selected.map((pointId, index) => {
              const point = points.data?.find(({ id }) => id === pointId);
              const shared = rounds.data?.some(
                (round) =>
                  round.id !== editingId &&
                  round.currentVersion?.checkpoints.some(
                    ({ checkpoint }) => checkpoint.id === pointId,
                  ),
              );
              return (
                <li
                  key={pointId}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', pointId);
                  }}
                  onDrop={(event) => {
                    const source = event.dataTransfer.getData('text/plain');
                    setSelected((items) => {
                      const reordered = [...items];
                      const from = reordered.indexOf(source);
                      if (from >= 0) {
                        reordered.splice(from, 1);
                        reordered.splice(index, 0, source);
                      }
                      return reordered;
                    });
                  }}
                  className="flex items-center gap-2"
                >
                  {point?.name}
                  {shared && (
                    <span>Compartido con otra ronda (un registro cuenta para ambas).</span>
                  )}
                  <button
                    type="button"
                    aria-label={`Subir ${point?.name}`}
                    disabled={index === 0}
                    onClick={() => {
                      setSelected((items) => {
                        const copy = [...items];
                        const current = copy[index];
                        const previous = copy[index - 1];
                        if (current !== undefined && previous !== undefined) {
                          copy[index - 1] = current;
                          copy[index] = previous;
                        }
                        return copy;
                      });
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Bajar ${point?.name}`}
                    disabled={index === selected.length - 1}
                    onClick={() => {
                      setSelected((items) => {
                        const copy = [...items];
                        const current = copy[index];
                        const next = copy[index + 1];
                        if (current !== undefined && next !== undefined) {
                          copy[index] = next;
                          copy[index + 1] = current;
                        }
                        return copy;
                      });
                    }}
                  >
                    ↓
                  </button>
                </li>
              );
            })}
          </ol>
          <div>
            <h5>Vista previa de ventanas</h5>
            <ol aria-label="Vista previa de ventanas">
              {labels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ol>
          </div>
          {(Object.keys(fieldErrors).length > 1 || Boolean(fieldErrors.form ?? message)) && (
            <div role="alert" aria-label="Errores del formulario">
              {message && <p>{message}</p>}
              {Object.keys(fieldErrors).length > 1 &&
                Object.values(fieldErrors)
                  .flat()
                  .map((error) => <p key={error}>{error}</p>)}
              {fieldErrors.form?.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          )}
          <button className="rounded bg-primary px-3 py-2 text-primary-foreground">
            Guardar ronda
          </button>
        </form>
      )}
    </section>
  );
}
