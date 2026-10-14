import { useQuery } from '@tanstack/react-query';
import {
  siteInputSchema,
  sitesResponseSchema,
  updateSiteSpeedSchema,
  type SpeedProfile,
} from '@garita/shared';
import { apiGet, apiPost, apiPut, apiPatch } from '@/lib/api-client';
import { errorMessage } from '@/lib/error-message';
import { useAuth } from '../auth/auth-context';
import { useState } from 'react';
import type { SyntheticEvent } from 'react';
import { SiteLocation } from '../mapa/site-location';
import { z } from 'zod';
import { CheckpointsPanel } from '../puntos/checkpoints-panel';
import { RoundsPanel } from '../rondas/rounds-panel';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function SiteSpeedConfig({
  site,
  canConfigure,
  onSaved,
}: {
  site: z.infer<typeof sitesResponseSchema>[number];
  canConfigure: boolean;
  onSaved: () => void;
}) {
  const [profile, setProfile] = useState<SpeedProfile>(site.maxSpeedProfile ?? 'walking');
  const [customSpeed, setCustomSpeed] = useState<number>(site.maxSpeedKmh ?? 10);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  if (!canConfigure) {
    const profileLabel =
      site.maxSpeedProfile === 'bicycle'
        ? 'Bicicleta (25 km/h)'
        : site.maxSpeedProfile === 'vehicle'
          ? 'Vehículo (60 km/h)'
          : site.maxSpeedProfile === 'custom'
            ? `Personalizado (${site.maxSpeedKmh ?? 10} km/h)`
            : 'A pie (10 km/h)';
    return (
      <div className="mt-2 text-sm text-muted-foreground">
        <span>Velocidad máxima de recorrido: </span>
        <span className="font-medium">{profileLabel}</span>
      </div>
    );
  }

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess(false);

    const payload = {
      maxSpeedProfile: profile,
      maxSpeedKmh: profile === 'custom' ? customSpeed : undefined,
    };
    const parsed = updateSiteSpeedSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisá los datos');
      return;
    }

    setSaving(true);
    try {
      await apiPatch(
        `/predios/${site.id}/recorrido`,
        parsed.data,
        updateSiteSpeedSchema,
        z.unknown(),
      );
      setSuccess(true);
      onSaved();
    } catch (caught: unknown) {
      setError(errorMessage(caught, 'No se pudo actualizar la velocidad'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="mt-3 rounded border p-3">
      <label htmlFor={`speed-profile-${site.id}`} className="block text-sm font-medium">
        Velocidad máxima de recorrido
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <select
          id={`speed-profile-${site.id}`}
          aria-label={`Velocidad máxima de recorrido para ${site.name}`}
          value={profile}
          onChange={(event) => {
            setProfile(event.target.value as SpeedProfile);
            setSuccess(false);
            setError('');
          }}
          className="rounded border p-2 text-sm"
        >
          <option value="walking">A pie (10 km/h)</option>
          <option value="bicycle">Bicicleta (25 km/h)</option>
          <option value="vehicle">Vehículo (60 km/h)</option>
          <option value="custom">Personalizado</option>
        </select>

        {profile === 'custom' && (
          <div className="flex items-center gap-2">
            <label htmlFor={`speed-kmh-${site.id}`} className="text-sm font-medium">
              km/h:
            </label>
            <input
              id={`speed-kmh-${site.id}`}
              type="number"
              min={5}
              max={120}
              aria-label={`Velocidad personalizada en km/h para ${site.name}`}
              value={customSpeed}
              onChange={(event) => {
                setCustomSpeed(Number(event.target.value));
                setSuccess(false);
                setError('');
              }}
              className="w-24 rounded border p-2 text-sm"
              required
            />
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
        >
          {saving ? 'Guardando…' : 'Guardar velocidad'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="mt-2 text-sm text-green-700">
          Velocidad actualizada correctamente
        </p>
      )}
    </form>
  );
}

export function SitesPage() {
  const { user } = useAuth();
  const sites = useQuery({
    queryKey: ['predios'],
    queryFn: () => apiGet('/predios', sitesResponseSchema),
  });
  const clients = useQuery({
    queryKey: ['clientes'],
    queryFn: () =>
      apiGet('/clientes', z.array(z.looseObject({ id: z.string(), name: z.string() }))),
  });
  const [form, setForm] = useState({
    clientId: '',
    name: '',
    address: '',
    latitude: 0,
    longitude: 0,
    accessInstructions: '',
    observations: '',
  });
  const [supervisorIds, setSupervisorIds] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<z.infer<typeof sitesResponseSchema>[number] | null>(null);
  const [editForm, setEditForm] = useState({
    clientId: '',
    name: '',
    address: '',
    latitude: 0,
    longitude: 0,
    accessInstructions: '',
    observations: '',
  });
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const impact = useQuery({
    queryKey: ['predio-impacto-baja', deleting?.id],
    enabled: deleting !== null,
    queryFn: () =>
      apiGet(
        `/predios/${deleting?.id ?? ''}/impacto-baja`,
        z.looseObject({
          shiftsToCancel: z.number(),
          weeklySchedulesToEnd: z.number(),
          inProgressShiftsToClose: z.number(),
          shifts: z.array(
            z.looseObject({ id: z.string(), startsAt: z.string(), endsAt: z.string() }),
          ),
        }),
      ),
  });
  const supervisors = useQuery({
    queryKey: ['supervisores'],
    queryFn: () =>
      apiGet(
        '/predios/supervisores-disponibles',
        z.array(z.looseObject({ id: z.string(), firstName: z.string(), lastName: z.string() })),
      ),
    enabled: user?.role === 'admin',
  });
  const response = z.looseObject({ id: z.string() });
  const [createError, setCreateError] = useState('');
  const [editError, setEditError] = useState('');
  const [actionError, setActionError] = useState('');
  const save = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = siteInputSchema.safeParse(form);
    if (!parsed.success) {
      setCreateError(parsed.error.issues[0]?.message ?? 'Revisá los datos');
      return;
    }
    try {
      await apiPost('/predios', parsed.data, siteInputSchema, response);
      setCreateError('');
      await sites.refetch();
    } catch (caught) {
      setCreateError(errorMessage(caught, 'Ya existe un predio con ese nombre en el cliente'));
    }
  };
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-semibold">Predios</h1>
      {user?.role === 'admin' && (
        <form className="grid gap-3 rounded border p-4" onSubmit={(event) => void save(event)}>
          <h2 className="text-xl font-semibold">Alta de predio</h2>
          <label>
            Cliente
            <select
              required
              value={form.clientId}
              onChange={(event) => {
                setForm({ ...form, clientId: event.target.value });
              }}
              className="block rounded border p-2"
            >
              <option value="" disabled>
                Seleccioná un cliente
              </option>
              {clients.data?.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nombre
            <input
              required
              value={form.name}
              onChange={(event) => {
                setForm({ ...form, name: event.target.value });
              }}
              className="block rounded border p-2"
            />
          </label>
          <label>
            Dirección
            <input
              required
              value={form.address}
              onChange={(event) => {
                setForm({ ...form, address: event.target.value });
              }}
              className="block rounded border p-2"
            />
          </label>
          <SiteLocation
            latitude={form.latitude}
            longitude={form.longitude}
            onChange={(latitude, longitude) => {
              setForm({ ...form, latitude, longitude });
            }}
          />
          <label>
            Instrucciones de acceso
            <textarea
              value={form.accessInstructions}
              onChange={(event) => {
                setForm({ ...form, accessInstructions: event.target.value });
              }}
              className="block rounded border p-2"
            />
          </label>
          <label>
            Observaciones
            <textarea
              value={form.observations}
              onChange={(event) => {
                setForm({ ...form, observations: event.target.value });
              }}
              className="block rounded border p-2"
            />
          </label>
          {createError && <p role="alert">{createError}</p>}
          <button className="rounded bg-primary px-4 py-2 text-primary-foreground">
            Guardar predio
          </button>
        </form>
      )}
      {actionError && <p role="alert">{actionError}</p>}
      {sites.isPending ? (
        <p role="status">Cargando predios…</p>
      ) : sites.isError ? (
        <p role="alert">No se pudieron cargar los predios.</p>
      ) : (
        <ul className="divide-y">
          {sites.data.map((site) => (
            <li key={site.id} className="py-4">
              <h2 className="font-semibold">{site.name}</h2>
              <p>
                {site.address} · {site.latitude}, {site.longitude}
              </p>
              {site.status === 'active' && (
                <span className="text-sm">
                  {user?.role === 'supervisor' ? 'Solo lectura' : 'Administración'}
                </span>
              )}
              <CheckpointsPanel site={site} />
              <RoundsPanel site={site} />
              <SiteSpeedConfig
                site={site}
                canConfigure={
                  site.status === 'active' &&
                  (user?.role === 'admin' ||
                    (user?.role === 'supervisor' &&
                      Boolean(site.supervisors?.some(({ user: u }) => u.id === user.id))))
                }
                onSaved={() => void sites.refetch()}
              />
              {user?.role === 'admin' && !site.hasActiveSupervisor && (
                <p role="status">Sin supervisor activo</p>
              )}
              {user?.role === 'admin' && site.status === 'active' && (
                <div className="mt-2 space-y-2">
                  <label className="block">
                    Supervisores asignados
                    <select
                      multiple
                      aria-label={`Supervisores de ${site.name}`}
                      value={
                        supervisorIds[site.id] ?? site.supervisors?.map(({ user }) => user.id) ?? []
                      }
                      onChange={(event) => {
                        const selected = [...event.currentTarget.selectedOptions].map(
                          (option) => option.value,
                        );
                        const previous =
                          supervisorIds[site.id] ??
                          site.supervisors?.map(({ user }) => user.id) ??
                          [];
                        // Muestra la selección al instante y la revierte si el guardado falla.
                        setSupervisorIds((current) => ({ ...current, [site.id]: selected }));
                        setActionError('');
                        void apiPut(
                          `/predios/${site.id}/supervisores`,
                          { supervisorIds: selected },
                          z.object({ supervisorIds: z.array(z.string()) }),
                          z.array(z.unknown()),
                        )
                          .then(() => sites.refetch())
                          .catch((caught: unknown) => {
                            setSupervisorIds((current) => ({ ...current, [site.id]: previous }));
                            setActionError(errorMessage(caught));
                          });
                      }}
                      className="block min-h-24 w-full rounded border p-2"
                    >
                      {supervisors.data?.map((supervisor) => (
                        <option key={supervisor.id} value={supervisor.id}>
                          {supervisor.firstName} {supervisor.lastName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="underline"
                    onClick={() => {
                      setEditError('');
                      setEditing(site);
                      setEditForm({
                        clientId: site.clientId,
                        name: site.name,
                        address: site.address,
                        latitude: Number(site.latitude),
                        longitude: Number(site.longitude),
                        accessInstructions: site.accessInstructions ?? '',
                        observations: site.observations ?? '',
                      });
                    }}
                  >
                    Editar predio
                  </button>
                  <button
                    className="ml-4 underline"
                    onClick={() => {
                      setDeleting({ id: site.id, name: site.name });
                    }}
                  >
                    Dar de baja
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setEditError('');
          }
        }}
      >
        <DialogContent aria-describedby="site-edit-description">
          <DialogTitle>Editar predio</DialogTitle>
          <DialogDescription id="site-edit-description">
            Actualizá los datos, la ubicación y las indicaciones del predio.
          </DialogDescription>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = siteInputSchema.safeParse(editForm);
              if (!parsed.success) {
                setEditError(parsed.error.issues[0]?.message ?? 'Revisá los datos');
                return;
              }
              if (!editing) return;
              void apiPatch(`/predios/${editing.id}`, parsed.data, siteInputSchema, response)
                .then(() => {
                  setEditing(null);
                  setEditError('');
                  return sites.refetch();
                })
                .catch((caught: unknown) => {
                  setEditError(
                    errorMessage(caught, 'Ya existe un predio con ese nombre en el cliente'),
                  );
                });
            }}
          >
            <label>
              Nombre
              <input
                required
                value={editForm.name}
                onChange={(event) => {
                  setEditForm({ ...editForm, name: event.target.value });
                }}
                className="block w-full rounded border p-2"
              />
            </label>
            <label>
              Dirección
              <input
                required
                value={editForm.address}
                onChange={(event) => {
                  setEditForm({ ...editForm, address: event.target.value });
                }}
                className="block w-full rounded border p-2"
              />
            </label>
            <SiteLocation
              latitude={editForm.latitude}
              longitude={editForm.longitude}
              onChange={(latitude, longitude) => {
                setEditForm({ ...editForm, latitude, longitude });
              }}
            />
            <label>
              Instrucciones de acceso
              <textarea
                value={editForm.accessInstructions}
                onChange={(event) => {
                  setEditForm({ ...editForm, accessInstructions: event.target.value });
                }}
                className="block w-full rounded border p-2"
              />
            </label>
            <label>
              Observaciones
              <textarea
                value={editForm.observations}
                onChange={(event) => {
                  setEditForm({ ...editForm, observations: event.target.value });
                }}
                className="block w-full rounded border p-2"
              />
            </label>
            {editError && <p role="alert">{editError}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                className="rounded border px-4 py-2"
                onClick={() => {
                  setEditing(null);
                }}
              >
                Cancelar
              </button>
              <button className="rounded bg-primary px-4 py-2 text-primary-foreground">
                Guardar cambios
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Dar de baja el predio</AlertDialogTitle>
          <AlertDialogDescription>
            Se dará de baja {deleting?.name} y se quitarán las asignaciones de supervisores.
          </AlertDialogDescription>
          {impact.isPending ? (
            <p role="status">Consultando el impacto de la baja…</p>
          ) : impact.isError ? (
            <p role="alert">
              No se pudo consultar el impacto. Cerrá el diálogo e intentá nuevamente.
            </p>
          ) : (
            <div className="my-4 space-y-2" aria-live="polite">
              <p>
                Se cancelarán {impact.data.shiftsToCancel} turnos, terminarán{' '}
                {impact.data.weeklySchedulesToEnd} programaciones semanales y se cerrarán{' '}
                {impact.data.inProgressShiftsToClose} turnos en curso.
              </p>
              {impact.data.shifts.length > 0 && (
                <ul aria-label="Turnos que se cancelarán">
                  {impact.data.shifts.map((shift) => (
                    <li key={shift.id}>
                      {new Date(shift.startsAt).toLocaleString('es-AR')}–
                      {new Date(shift.endsAt).toLocaleString('es-AR')}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="mt-5 flex justify-end gap-3">
            <AlertDialogCancel className="rounded border px-4 py-2">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!impact.isSuccess}
              className="rounded bg-destructive px-4 py-2 text-white"
              onClick={() => {
                if (deleting) {
                  setActionError('');
                  void apiPost(
                    `/predios/${deleting.id}/baja`,
                    { confirm: true },
                    z.object({ confirm: z.boolean() }),
                    response,
                  )
                    .then(() => sites.refetch())
                    .catch((caught: unknown) => {
                      setActionError(errorMessage(caught));
                    });
                }
              }}
            >
              Confirmar baja
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
