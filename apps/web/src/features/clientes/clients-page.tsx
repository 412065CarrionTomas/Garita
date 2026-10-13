import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientInputSchema, clientsResponseSchema, clientResponseSchema } from '@garita/shared';
import { lazy, Suspense, useState } from 'react';
import { useParams } from 'react-router';
import { apiGet, apiPost, apiPatch, ApiError } from '@/lib/api-client';
import { env } from '@/config/env';
import { errorMessage } from '@/lib/error-message';
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

const response = z.looseObject({ id: z.string() });
const ClientSitesMap = lazy(() =>
  import('../mapa/site-location-map').then((module) => ({ default: module.ClientSitesMap })),
);
export function ClientsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', contactName: '', phone: '', email: '', taxId: '' });
  const clients = useQuery({
    queryKey: ['clientes'],
    queryFn: () => apiGet('/clientes', clientsResponseSchema),
  });
  const create = useMutation({
    mutationFn: () => apiPost('/clientes', form, clientInputSchema, response),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clientes'] });
      setForm({ name: '', contactName: '', phone: '', email: '', taxId: '' });
    },
  });
  const [error, setError] = useState('');
  const [editError, setEditError] = useState('');
  const [actionError, setActionError] = useState('');
  const [editing, setEditing] = useState<z.infer<typeof clientsResponseSchema>[number] | null>(
    null,
  );
  const [editForm, setEditForm] = useState({
    name: '',
    contactName: '',
    phone: '',
    email: '',
    taxId: '',
  });
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-semibold">Clientes</h1>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = clientInputSchema.safeParse(form);
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Revisá los datos');
            return;
          }
          setError('');
          create.mutate();
        }}
      >
        {(['name', 'contactName', 'phone', 'email', 'taxId'] as const).map((key) => (
          <label key={key} className="grid gap-1">
            {
              {
                name: 'Nombre o razón social',
                contactName: 'Persona de contacto',
                phone: 'Teléfono',
                email: 'Correo',
                taxId: 'CUIT (opcional)',
              }[key]
            }
            <input
              required={key !== 'taxId'}
              type={key === 'email' ? 'email' : 'text'}
              value={form[key]}
              onChange={(event) => {
                setForm({ ...form, [key]: event.target.value });
              }}
              className="rounded border p-2"
            />
          </label>
        ))}
        <button className="rounded bg-primary px-4 py-2 text-primary-foreground">
          Registrar cliente
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
      {create.error && (
        <p role="alert">
          {create.error instanceof ApiError && create.error.status === 409
            ? 'Ya existe un cliente con ese nombre'
            : create.error.message}
        </p>
      )}
      {actionError && <p role="alert">{actionError}</p>}
      <h2 className="text-xl font-semibold">Listado</h2>
      {clients.isPending ? (
        <p role="status">Cargando clientes…</p>
      ) : clients.isError ? (
        <p role="alert">No se pudieron cargar los clientes.</p>
      ) : (
        <ul className="divide-y">
          {clients.data.map((client) => (
            <li key={client.id} className="py-3">
              <strong>
                <a className="underline" href={`/clientes/${client.id}`}>
                  {client.name}
                </a>
              </strong>
              <p>
                {client.contactName} · {client.phone} · {client.email}
              </p>
              <button
                className="underline"
                onClick={() => {
                  setEditError('');
                  setEditing(client);
                  setEditForm({
                    name: client.name,
                    contactName: client.contactName,
                    phone: client.phone,
                    email: client.email,
                    taxId: client.taxId ?? '',
                  });
                }}
              >
                Editar
              </button>
              <button
                className="ml-4 underline"
                onClick={() => {
                  setDeleting({ id: client.id, name: client.name });
                }}
              >
                Dar de baja
              </button>
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
        <DialogContent aria-describedby="client-edit-description">
          <DialogTitle>Editar cliente</DialogTitle>
          <DialogDescription id="client-edit-description">
            Actualizá todos los datos del cliente.
          </DialogDescription>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = clientInputSchema.safeParse(editForm);
              if (!parsed.success) {
                setEditError(parsed.error.issues[0]?.message ?? 'Revisá los datos');
                return;
              }
              if (!editing) return;
              void apiPatch(`/clientes/${editing.id}`, parsed.data, clientInputSchema, response)
                .then(() => {
                  setEditing(null);
                  setEditError('');
                  return queryClient.invalidateQueries({ queryKey: ['clientes'] });
                })
                .catch((caught: unknown) => {
                  setEditError(errorMessage(caught, 'Ya existe un cliente con ese nombre'));
                });
            }}
          >
            {(['name', 'contactName', 'phone', 'email', 'taxId'] as const).map((key) => (
              <label key={key} className="grid gap-1">
                {
                  {
                    name: 'Nombre o razón social',
                    contactName: 'Persona de contacto',
                    phone: 'Teléfono',
                    email: 'Correo',
                    taxId: 'CUIT (opcional)',
                  }[key]
                }
                <input
                  required={key !== 'taxId'}
                  type={key === 'email' ? 'email' : 'text'}
                  value={editForm[key]}
                  onChange={(event) => {
                    setEditForm({ ...editForm, [key]: event.target.value });
                  }}
                  className="rounded border p-2"
                />
              </label>
            ))}
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
          <AlertDialogTitle>Dar de baja al cliente</AlertDialogTitle>
          <AlertDialogDescription>
            La baja de {deleting?.name} también dará de baja sus predios y quitará todas las
            asignaciones de supervisores. Esta acción no se puede deshacer.
          </AlertDialogDescription>
          <div className="mt-5 flex justify-end gap-3">
            <AlertDialogCancel className="rounded border px-4 py-2">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded bg-destructive px-4 py-2 text-white"
              onClick={() => {
                if (deleting) {
                  setActionError('');
                  void apiPost(`/clientes/${deleting.id}/baja`, {}, z.looseObject({}), response)
                    .then(() => queryClient.invalidateQueries({ queryKey: ['clientes'] }))
                    .catch((caught: unknown) => {
                      setActionError(errorMessage(caught));
                    });
                }
              }}
            >
              Dar de baja cliente
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export function ClientDetailPage() {
  const { id } = useParams();
  const client = useQuery({
    queryKey: ['cliente', id],
    queryFn: () => apiGet(`/clientes/${id ?? ''}`, clientResponseSchema),
    enabled: Boolean(id),
  });
  if (client.isPending) return <p role="status">Cargando ficha…</p>;
  if (client.isError) return <p role="alert">No se pudo cargar la ficha del cliente.</p>;
  const activeSites = client.data.sites.filter((site) => site.status === 'active');
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-semibold">{client.data.name}</h1>
      <p>
        {client.data.contactName} · {client.data.phone} · {client.data.email}
      </p>
      <h2 className="text-xl font-semibold">Predios activos</h2>
      {env.VITE_GOOGLE_MAPS_API_KEY ? (
        <Suspense fallback={<p role="status">Cargando mapa…</p>}>
          <ClientSitesMap sites={activeSites} />
        </Suspense>
      ) : (
        <p role="status">
          El mapa no está configurado; coordenadas disponibles para carga y consulta manual.
        </p>
      )}
      <ul className="divide-y">
        {activeSites.map((site) => (
          <li key={site.id} className="py-3">
            {site.name}: {site.address} · {site.latitude}, {site.longitude}
          </li>
        ))}
      </ul>
    </section>
  );
}
