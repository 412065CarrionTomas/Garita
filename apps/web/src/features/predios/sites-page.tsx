import { useQuery } from '@tanstack/react-query';
import { sitesResponseSchema } from '@garita/shared';
import { apiGet, apiPost, apiPut } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';
import { useState } from 'react';
import type { SyntheticEvent } from 'react';
import { siteInputSchema } from '@garita/shared';
import { SiteLocation } from '../mapa/site-location';
import { z } from 'zod';

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
  const supervisors = useQuery({
    queryKey: ['supervisores'],
    queryFn: () =>
      apiGet(
        '/usuarios?rol=supervisor',
        z.array(z.looseObject({ id: z.string(), firstName: z.string(), lastName: z.string() })),
      ),
    enabled: user?.role === 'admin',
  });
  const assignments = useQuery({
    queryKey: ['asignaciones-supervisores', sites.data?.map((site) => site.id)],
    enabled: user?.role === 'admin' && sites.data !== undefined,
    queryFn: async () => {
      const currentSites = sites.data ?? [];
      const entries = await Promise.all(
        currentSites.map(async (site) => {
          const assigned = await apiGet(
            `/predios/${site.id}/supervisores`,
            z.array(z.looseObject({ user: z.looseObject({ id: z.string() }) })),
          );
          return [site.id, assigned.map(({ user: assignedUser }) => assignedUser.id)] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
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
                <label className="mt-2 block">
                  Supervisores asignados
                  <select
                    multiple
                    aria-label={`Supervisores de ${site.name}`}
                    value={supervisorIds[site.id] ?? assignments.data?.[site.id] ?? []}
                    disabled={assignments.isPending}
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
                      );
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
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
