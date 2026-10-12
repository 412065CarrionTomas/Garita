import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

const pageSchema = usersPageSchema;
export function PersonalPage() {
  const { user } = useAuth();
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const queryClient = useQueryClient();
  const params = new URLSearchParams({ pagina: '1' });
  if (role) params.set('rol', role);
  if (status) params.set('estado', status);
  const result = useQuery({
    queryKey: ['personal', role, status],
    queryFn: () => apiGet(`/usuarios?${params.toString()}`, pageSchema),
  });
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
          }}
          className="rounded-md border px-3 py-2"
        >
          Agregar personal
        </button>
      )}
      {creating && (
        <form
          className="grid gap-3 rounded border p-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(event.currentTarget));
            const parsed = createUserRequestSchema.safeParse(values);
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
                await queryClient.invalidateQueries({ queryKey: ['personal'] });
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
                      const values = {
                        firstName: person.firstName,
                        lastName: person.lastName,
                        phone: person.phone ?? '',
                        employeeNumber: person.employeeNumber ?? '',
                      };
                      const firstName = window.prompt('Nombre', values.firstName);
                      if (firstName === null) return;
                      const lastName = window.prompt('Apellido', values.lastName);
                      if (lastName === null) return;
                      const phone = window.prompt('Teléfono celular', values.phone);
                      if (phone === null) return;
                      const employeeNumber = window.prompt('Legajo', values.employeeNumber);
                      if (employeeNumber === null) return;
                      const input = { firstName, lastName, phone, employeeNumber };
                      const parsed = updateUserRequestSchema.safeParse(input);
                      if (!parsed.success) {
                        setFormError('Revisá el nombre, apellido, teléfono y legajo.');
                        return;
                      }
                      void apiPatch(
                        `/usuarios/${person.id}`,
                        parsed.data,
                        updateUserRequestSchema,
                        personnelUserSchema,
                      )
                        .then(async () => {
                          await queryClient.invalidateQueries({ queryKey: ['personal'] });
                        })
                        .catch(() => {
                          setFormError('No se pudo editar el registro.');
                        });
                    }}
                  >
                    Editar
                  </button>
                  {person.status === 'deactivated' ? (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        void apiPost(
                          `/usuarios/${person.id}/reactivar`,
                          {},
                          emptyRequestSchema,
                          emptyResponseSchema,
                        )
                          .then(async () => {
                            await queryClient.invalidateQueries({ queryKey: ['personal'] });
                          })
                          .catch(() => {
                            setFormError('No se pudo reactivar el usuario.');
                          });
                      }}
                    >
                      Reactivar
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        if (window.confirm(`¿Desactivar a ${person.firstName} ${person.lastName}?`))
                          void apiPost(
                            `/usuarios/${person.id}/desactivar`,
                            {},
                            emptyRequestSchema,
                            emptyResponseSchema,
                          )
                            .then(async () => {
                              await queryClient.invalidateQueries({ queryKey: ['personal'] });
                            })
                            .catch(() => {
                              setFormError('No se pudo desactivar el usuario.');
                            });
                      }}
                    >
                      Desactivar
                    </button>
                  )}
                  {person.status === 'invitation_pending' && (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        void apiPost(
                          `/usuarios/${person.id}/reenviar-invitacion`,
                          {},
                          emptyRequestSchema,
                          personnelUserSchema,
                        )
                          .then(async () => {
                            await queryClient.invalidateQueries({ queryKey: ['personal'] });
                          })
                          .catch(() => {
                            setFormError('No se pudo reenviar la invitación.');
                          });
                      }}
                    >
                      Reenviar invitación
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
