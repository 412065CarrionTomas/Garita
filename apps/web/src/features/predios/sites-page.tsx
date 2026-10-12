import { useQuery } from '@tanstack/react-query';
import { siteInputSchema, sitesResponseSchema } from '@garita/shared';
import { apiGet, apiPost, apiPut, apiPatch } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';
import { useState } from 'react';
import type { SyntheticEvent } from 'react';
import { SiteLocation } from '../mapa/site-location';
import { z } from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

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
  const save = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = siteInputSchema.safeParse(form);
    if (!parsed.success) return;
    await apiPost('/predios', parsed.data, siteInputSchema, response);
    await sites.refetch();
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
          <button className="rounded bg-primary px-4 py-2 text-primary-foreground">
            Guardar predio
          </button>
        </form>
      )}
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
                        setSupervisorIds({ ...supervisorIds, [site.id]: selected });
                        void apiPut(
                          `/predios/${site.id}/supervisores`,
                          { supervisorIds: selected },
                          z.object({ supervisorIds: z.array(z.string()) }),
                          z.array(z.unknown()),
                        ).then(() => sites.refetch());
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
          if (!open) setEditing(null);
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
              if (!parsed.success || !editing) return;
              void apiPatch(`/predios/${editing.id}`, parsed.data, siteInputSchema, response).then(
                () => {
                  setEditing(null);
                  return sites.refetch();
                },
              );
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
            Se dará de baja {deleting?.name} y se quitarán las asignaciones de supervisores. Esta
            acción no se puede deshacer.
          </AlertDialogDescription>
          <div className="mt-5 flex justify-end gap-3">
            <AlertDialogCancel className="rounded border px-4 py-2">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded bg-destructive px-4 py-2 text-white"
              onClick={() => {
                if (deleting)
                  void apiPost(
                    `/predios/${deleting.id}/baja`,
                    {},
                    z.looseObject({}),
                    response,
                  ).then(() => sites.refetch());
              }}
            >
              Dar de baja predio
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
