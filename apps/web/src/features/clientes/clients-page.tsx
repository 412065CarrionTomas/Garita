import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientInputSchema, clientsResponseSchema, clientResponseSchema } from '@garita/shared';
import { lazy, Suspense, useState } from 'react';
import { useParams } from 'react-router';
import { apiGet, apiPost, apiPatch, ApiError } from '@/lib/api-client';
import { env } from '@/config/env';
import { z } from 'zod';

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
                  const name = window.prompt('Nuevo nombre', client.name);
                  if (name)
                    void apiPatch(
                      `/clientes/${client.id}`,
                      { ...client, name },
                      clientInputSchema,
                      response,
                    ).then(() => queryClient.invalidateQueries({ queryKey: ['clientes'] }));
                }}
              >
                Editar
              </button>
              <button
                className="ml-4 underline"
                onClick={() => {
                  if (window.confirm(`¿Dar de baja a ${client.name} y todos sus predios?`))
                    void apiPost(
                      `/clientes/${client.id}/baja`,
                      {},
                      z.looseObject({}),
                      response,
                    ).then(() => queryClient.invalidateQueries({ queryKey: ['clientes'] }));
                }}
              >
                Dar de baja
              </button>
            </li>
          ))}
        </ul>
      )}
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
