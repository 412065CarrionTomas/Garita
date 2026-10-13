import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  createUserRequestSchema,
  emptyRequestSchema,
  emptyResponseSchema,
  personnelUserSchema,
  updateUserRequestSchema,
  usersPageSchema,
} from '@garita/shared';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';

type Person = ReturnType<typeof personnelUserSchema.parse>;

export function PersonalPage() {
  const { user } = useAuth();
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [deactivating, setDeactivating] = useState<Person | null>(null);
  const [deriveToUserId, setDeriveToUserId] = useState('');
  const [leaveUnassigned, setLeaveUnassigned] = useState(false);
  const [notDerived, setNotDerived] = useState<{ id: string; name: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const editDialog = useRef<HTMLDialogElement>(null);
  const deactivateDialog = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const futureShifts = useQuery({
    queryKey: ['personal', deactivating?.id, 'turnos-futuros'],
    enabled: deactivating?.role === 'guard',
    queryFn: () =>
      apiGet(
        `/usuarios/${deactivating?.id ?? ''}/turnos-futuros`,
        z.array(
          z.looseObject({
            id: z.string(),
            startsAt: z.string(),
            endsAt: z.string(),
            site: z.looseObject({ name: z.string() }),
          }),
        ),
      ),
  });
  const guardOptions = useQuery({
    queryKey: ['personal', 'vigiladores', 'derivacion'],
    enabled: deactivating?.role === 'guard',
    queryFn: () => apiGet('/usuarios?rol=guard&pagina=1', usersPageSchema),
  });
  const params = new URLSearchParams({ pagina: String(page) });
  if (role) params.set('rol', role);
  if (status) params.set('estado', status);
  const result = useQuery({
    queryKey: ['personal', role, status, page],
    queryFn: () => apiGet(`/usuarios?${params.toString()}`, usersPageSchema),
  });
  useEffect(() => {
    const dialog = editDialog.current;
    if (editing && dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (!editing && dialog?.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [editing]);
  useEffect(() => {
    const dialog = deactivateDialog.current;
    if (deactivating && dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (!deactivating && dialog?.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [deactivating]);
  const refresh = async () => queryClient.invalidateQueries({ queryKey: ['personal'] });
  const runAction = async (path: string, failure: string) => {
    try {
      await apiPost(path, {}, emptyRequestSchema, emptyResponseSchema);
      setFormError('');
      await refresh();
    } catch {
      setFormError(failure);
    }
  };
  const saveEdit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = updateUserRequestSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      return;
    }
    try {
      await apiPatch(
        `/usuarios/${editing.id}`,
        parsed.data,
        updateUserRequestSchema,
        personnelUserSchema,
      );
      setEditing(null);
      setErrors({});
      setFormError('');
      await refresh();
    } catch {
      setFormError('No se pudo editar el registro.');
    }
  };
  const renderErrors = () =>
    Object.entries(errors).map(([field, message]) => (
      <span id={`${field}-error`} className="text-sm text-red-700" key={field}>
        {message}
      </span>
    ));
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-semibold">Personal</h1>
      <p>Supervisores y vigiladores de tu empresa.</p>
      <div className="flex flex-wrap gap-3">
        <label>
          Rol
          <select
            aria-label="Filtrar por rol"
            className="ml-2 rounded border p-2"
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            <option value="supervisor">Supervisor</option>
            <option value="guard">Vigilador</option>
          </select>
        </label>
        <label>
          Estado
          <select
            aria-label="Filtrar por estado"
            className="ml-2 rounded border p-2"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            <option value="invitation_pending">Invitación pendiente</option>
            <option value="active">Activo</option>
            <option value="deactivated">Desactivado</option>
          </select>
        </label>
      </div>
      {user?.role === 'admin' && (
        <button
          type="button"
          onClick={() => {
            setCreating(!creating);
            setFormError('');
          }}
          className="rounded-md border px-3 py-2"
        >
          Agregar personal
        </button>
      )}
      {creating && (
        <form
          aria-label="Agregar personal"
          className="grid gap-3 rounded border p-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = createUserRequestSchema.safeParse(
              Object.fromEntries(new FormData(event.currentTarget)),
            );
            if (!parsed.success) {
              setErrors(
                Object.fromEntries(
                  parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
                ),
              );
              return;
            }
            setErrors({});
            setFormError('');
            void apiPost('/usuarios', parsed.data, createUserRequestSchema, personnelUserSchema)
              .then(async () => {
                await refresh();
                setCreating(false);
              })
              .catch((error: unknown) => {
                setFormError(
                  error instanceof ApiError && error.status === 409
                    ? 'Ese correo ya está en uso'
                    : 'No se pudo crear la invitación.',
                );
              });
          }}
        >
          {(['firstName', 'lastName', 'email', 'phone', 'employeeNumber'] as const).map((field) => (
            <label key={field} className="grid gap-1">
              {
                {
                  firstName: 'Nombre',
                  lastName: 'Apellido',
                  email: 'Correo',
                  phone: 'Teléfono celular',
                  employeeNumber: 'Legajo',
                }[field]
              }
              <input
                name={field}
                type={field === 'email' ? 'email' : 'text'}
                aria-invalid={Boolean(errors[field])}
                aria-describedby={errors[field] ? `${field}-error` : undefined}
                className="rounded border p-2"
              />
              {errors[field] && (
                <span id={`${field}-error`} className="text-sm text-red-700">
                  {errors[field]}
                </span>
              )}
            </label>
          ))}
          <label className="grid gap-1">
            Rol
            <select name="role" className="rounded border p-2">
              <option value="guard">Vigilador</option>
              <option value="supervisor">Supervisor</option>
            </select>
          </label>
          <div className="sm:col-span-2">
            {formError && <p role="alert">{formError}</p>}
            <button className="rounded border px-3 py-2">Enviar invitación</button>
          </div>
        </form>
      )}
      {result.isPending ? (
        <p role="status">Cargando personal…</p>
      ) : result.isError ? (
        <p role="alert">No se pudo cargar el personal.</p>
      ) : (
        <>
          <ul className="divide-y">
            {result.data.items.map((person) => (
              <li key={person.id} className="py-3">
                <strong>
                  {person.firstName} {person.lastName}
                </strong>{' '}
                · {person.role === 'guard' ? 'Vigilador' : 'Supervisor'} ·{' '}
                {person.status === 'invitation_pending'
                  ? person.invitationStatus === 'failed'
                    ? 'Envío fallido'
                    : 'Invitación pendiente'
                  : person.status === 'active'
                    ? 'Activo'
                    : 'Desactivado'}
                <p>{person.email}</p>
                {user?.role === 'admin' && (
                  <div className="mt-2 flex gap-3">
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        setEditing(person);
                        setErrors({});
                        setFormError('');
                      }}
                    >
                      Editar
                    </button>
                    {person.status === 'deactivated' ? (
                      <button
                        type="button"
                        className="underline"
                        onClick={() =>
                          void runAction(
                            `/usuarios/${person.id}/reactivar`,
                            'No se pudo reactivar el usuario.',
                          )
                        }
                      >
                        Reactivar
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="underline"
                        onClick={() => {
                          setDeactivating(person);
                          setDeriveToUserId('');
                          setLeaveUnassigned(false);
                          setNotDerived([]);
                          setFormError('');
                        }}
                      >
                        Desactivar
                      </button>
                    )}
                    {person.status === 'invitation_pending' && (
                      <button
                        type="button"
                        className="underline"
                        onClick={() =>
                          void runAction(
                            `/usuarios/${person.id}/reenviar-invitacion`,
                            'No se pudo reenviar la invitación.',
                          )
                        }
                      >
                        Reenviar invitación
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <nav aria-label="Paginación" className="flex items-center gap-3">
            <button
              type="button"
              className="rounded border px-3 py-2"
              disabled={page <= 1}
              onClick={() => {
                setPage((value) => value - 1);
              }}
            >
              Anterior
            </button>
            <span>
              Página {result.data.pagina} de {Math.max(1, result.data.paginas)}
            </span>
            <button
              type="button"
              className="rounded border px-3 py-2"
              disabled={page >= result.data.paginas}
              onClick={() => {
                setPage((value) => value + 1);
              }}
            >
              Siguiente
            </button>
          </nav>
        </>
      )}
      {formError && !creating && !editing && <p role="alert">{formError}</p>}
      {editing && (
        <dialog
          ref={editDialog}
          aria-labelledby="edit-title"
          aria-describedby="edit-description"
          onCancel={(event) => {
            event.preventDefault();
            setEditing(null);
          }}
          className="fixed inset-0 m-auto w-[min(36rem,calc(100%-2rem))] rounded-lg border p-6 shadow-xl backdrop:bg-black/50"
        >
          <form aria-label="Editar personal" onSubmit={(event) => void saveEdit(event)}>
            <h2 id="edit-title" className="text-xl font-semibold">
              Editar personal
            </h2>
            <p id="edit-description">Actualizá nombre, apellido, teléfono o legajo.</p>
            {(['firstName', 'lastName', 'phone', 'employeeNumber'] as const).map((field) => (
              <label key={field} className="mt-3 grid gap-1">
                {
                  {
                    firstName: 'Nombre',
                    lastName: 'Apellido',
                    phone: 'Teléfono celular',
                    employeeNumber: 'Legajo',
                  }[field]
                }
                <input
                  name={field}
                  defaultValue={editing[field] ?? ''}
                  aria-invalid={Boolean(errors[field])}
                  aria-describedby={errors[field] ? `${field}-error` : undefined}
                  className="rounded border p-2"
                />
                {errors[field] && (
                  <span id={`${field}-error`} className="text-sm text-red-700">
                    {errors[field]}
                  </span>
                )}
              </label>
            ))}
            {formError && <p role="alert">{formError}</p>}
            <div className="mt-4 flex gap-3">
              <button className="rounded border px-3 py-2">Guardar cambios</button>
              <button
                type="button"
                className="rounded border px-3 py-2"
                onClick={() => {
                  setEditing(null);
                }}
              >
                Cancelar
              </button>
            </div>
          </form>
        </dialog>
      )}
      {deactivating && (
        <dialog
          ref={deactivateDialog}
          aria-labelledby="deactivate-title"
          aria-describedby="deactivate-description"
          onCancel={(event) => {
            event.preventDefault();
            setDeactivating(null);
          }}
          className="fixed inset-0 m-auto w-[min(32rem,calc(100%-2rem))] rounded-lg border p-6 shadow-xl backdrop:bg-black/50"
        >
          <h2 id="deactivate-title" className="text-xl font-semibold">
            Desactivar usuario
          </h2>
          <p id="deactivate-description">
            ¿Querés desactivar a {deactivating.firstName} {deactivating.lastName}? Ya no podrá
            acceder a Garita.
          </p>
          {deactivating.role === 'guard' &&
            (futureShifts.isPending ? (
              <p role="status">Consultando turnos futuros…</p>
            ) : futureShifts.isError ? (
              <p role="alert">No se pudieron consultar los turnos futuros.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {futureShifts.data.length > 0 ? (
                  <>
                    <p>Tiene {futureShifts.data.length} turnos futuros:</p>
                    <ul className="max-h-40 list-disc overflow-auto pl-5">
                      {futureShifts.data.map((shift) => (
                        <li key={shift.id}>
                          {shift.site.name} · {new Date(shift.startsAt).toLocaleString('es-AR')}–
                          {new Date(shift.endsAt).toLocaleString('es-AR')}
                        </li>
                      ))}
                    </ul>
                    <label className="grid gap-1">
                      Derivar turnos a
                      <select
                        className="rounded border p-2"
                        value={deriveToUserId}
                        onChange={(event) => {
                          setDeriveToUserId(event.target.value);
                          setLeaveUnassigned(false);
                        }}
                      >
                        <option value="">Seleccioná un vigilador destino</option>
                        {guardOptions.data?.items
                          .filter(
                            (candidate) =>
                              candidate.id !== deactivating.id &&
                              (candidate.status === 'active' ||
                                candidate.status === 'invitation_pending'),
                          )
                          .map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.firstName} {candidate.lastName}
                              {candidate.status === 'invitation_pending'
                                ? ' · invitación pendiente'
                                : ''}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={leaveUnassigned}
                        onChange={(event) => {
                          setLeaveUnassigned(event.target.checked);
                          setDeriveToUserId('');
                        }}
                      />
                      <span>Dejar los turnos sin vigilador</span>
                    </label>
                    {leaveUnassigned && (
                      <p role="alert">
                        Se desactivará a {deactivating.firstName} y {futureShifts.data.length}{' '}
                        turnos quedarán sin vigilador. Si nadie los cubre, sus rondas contarán como
                        no realizadas. Confirmá esta cantidad en una segunda instancia.
                      </p>
                    )}
                    {notDerived.length > 0 && (
                      <div role="status">
                        <p>{notDerived.length} turnos no se pudieron derivar por superposición:</p>
                        <ul className="list-disc pl-5">
                          {notDerived.map((shift) => (
                            <li key={shift.id}>{shift.name}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : (
                  <p>No tiene turnos futuros.</p>
                )}
              </div>
            ))}
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              disabled={
                deactivating.role === 'guard' &&
                (futureShifts.isPending || futureShifts.isError || futureShifts.data.length > 0)
              }
              className="rounded border px-3 py-2"
              onClick={() => {
                const person = deactivating;
                void apiPost(
                  `/usuarios/${person.id}/desactivar`,
                  {},
                  emptyRequestSchema,
                  emptyResponseSchema,
                )
                  .then(async () => {
                    setDeactivating(null);
                    await refresh();
                  })
                  .catch(() => {
                    setFormError('No se pudo desactivar el usuario.');
                  });
              }}
            >
              Confirmar desactivación
            </button>
            {deactivating.role === 'guard' && deriveToUserId && (
              <button
                type="button"
                className="rounded border px-3 py-2"
                onClick={() => {
                  void apiPost(
                    `/usuarios/${deactivating.id}/desactivar`,
                    { deriveToUserId },
                    z.object({ deriveToUserId: z.string() }),
                    z.looseObject({
                      notDerived: z.array(
                        z.looseObject({
                          id: z.string(),
                          site: z.looseObject({ name: z.string() }),
                        }),
                      ),
                    }),
                  )
                    .then(async (result) => {
                      setNotDerived(
                        result.notDerived.map(({ id, site }) => ({ id, name: site.name })),
                      );
                      await refresh();
                      if (result.notDerived.length === 0) setDeactivating(null);
                    })
                    .catch(() => {
                      setFormError(
                        'No se pudieron derivar los turnos. Revisá las superposiciones.',
                      );
                    });
                }}
              >
                Derivar y desactivar
              </button>
            )}
            {deactivating.role === 'guard' && leaveUnassigned && futureShifts.data && (
              <button
                type="button"
                className="rounded border px-3 py-2"
                onClick={() => {
                  void apiPost(
                    `/usuarios/${deactivating.id}/desactivar`,
                    { leaveUnassigned: true, confirmUnassignedCount: futureShifts.data.length },
                    z.object({
                      leaveUnassigned: z.literal(true),
                      confirmUnassignedCount: z.number().int().nonnegative(),
                    }),
                    z.looseObject({}),
                  )
                    .then(async () => {
                      setDeactivating(null);
                      await refresh();
                    })
                    .catch(() => {
                      setFormError(
                        'No se pudo desactivar al vigilador con esa confirmación. Actualizá el impacto e intentá nuevamente.',
                      );
                    });
                }}
              >
                Confirmar que {futureShifts.data.length} turnos quedan sin vigilador
              </button>
            )}
            <button
              type="button"
              className="rounded border px-3 py-2"
              onClick={() => {
                setDeactivating(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </dialog>
      )}
      {renderErrors()}
    </section>
  );
}
