import { SiteConnectivityForm } from './site-connectivity-form';
import { useQuery } from '@tanstack/react-query';
import {
  siteInputSchema,
  checkpointsResponseSchema,
  siteConnectivitySchema,
  sitesResponseSchema,
  updateSiteSpeedSchema,
  type SpeedProfile,
} from '@garita/shared';
import { apiGet, apiPost, apiPut, apiPatch } from '@/lib/api-client';
import { errorMessage } from '@/lib/error-message';
import { useAuth } from '../auth/auth-context';
import { useEffect, useId, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { SiteLocation } from '../mapa/site-location';
import { z } from 'zod';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { CheckpointsPanel } from '../puntos/checkpoints-panel';
import { RoundsPanel } from '../rondas/rounds-panel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

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
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3">
      <Label
        htmlFor={`speed-profile-${site.id}`}
        className="font-cond block text-lg font-semibold tracking-wider text-foreground uppercase"
      >
        Velocidad máxima de recorrido
      </Label>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <NativeSelect
          id={`speed-profile-${site.id}`}
          aria-label={`Velocidad máxima de recorrido para ${site.name}`}
          value={profile}
          onChange={(event) => {
            setProfile(event.target.value as SpeedProfile);
            setSuccess(false);
            setError('');
          }}
          className="w-full sm:w-auto"
        >
          <NativeSelectOption value="walking">A pie (10 km/h)</NativeSelectOption>
          <NativeSelectOption value="bicycle">Bicicleta (25 km/h)</NativeSelectOption>
          <NativeSelectOption value="vehicle">Vehículo (60 km/h)</NativeSelectOption>
          <NativeSelectOption value="custom">Personalizado</NativeSelectOption>
        </NativeSelect>

        {profile === 'custom' && (
          <div className="flex items-center gap-2">
            <Label htmlFor={`speed-kmh-${site.id}`} className="text-sm font-medium">
              km/h:
            </Label>
            <Input
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
              className="w-24"
              required
            />
          </div>
        )}

        <Button type="submit" disabled={saving} variant="outline">
          {saving ? 'Guardando…' : 'Guardar velocidad'}
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="mt-2 text-sm text-success">
          Velocidad actualizada correctamente
        </p>
      )}
    </form>
  );
}

export function SitesPage() {
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  // Al elegir un predio la lista se pliega para dejarle el ancho al detalle y al mapa.
  const [listOpen, setListOpen] = useState(true);
  const [pointActions, setPointActions] = useState<HTMLDivElement | null>(null);
  const listId = useId();
  useEffect(() => {
    if (!listOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setListOpen(false);
    };
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('keydown', close);
    };
  }, [listOpen]);
  const sites = useQuery({
    queryKey: ['predios'],
    queryFn: () => apiGet('/predios', sitesResponseSchema),
  });
  const clients = useQuery({
    queryKey: ['clientes', 'activos', 'todos'],
    queryFn: async () => {
      const clients: { id: string; name: string }[] = [];
      for (let page = 1; ; page++) {
        const batch = await apiGet(
          `/clientes?estado=active&pagina=${page}`,
          z.array(z.looseObject({ id: z.string(), name: z.string() })),
        );
        clients.push(...batch);
        if (batch.length < 50) return clients;
      }
    },
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
      setCreating(false);
      setForm({
        clientId: '',
        name: '',
        address: '',
        latitude: 0,
        longitude: 0,
        accessInstructions: '',
        observations: '',
      });
      await sites.refetch();
    } catch (caught) {
      setCreateError(errorMessage(caught, 'Ya existe un predio con ese nombre en el cliente'));
    }
  };
  const selected = sites.data?.find((site) => site.id === selectedId) ?? sites.data?.[0];
  // Misma consulta que la pestaña Puntos (se comparte la caché): el total va junto al cliente.
  const points = useQuery({
    queryKey: ['puntos', selected?.id],
    queryFn: () => apiGet(`/predios/${selected?.id ?? ''}/puntos`, checkpointsResponseSchema),
    enabled: !!selected,
  });
  return (
    <section aria-labelledby="sites-title" className="space-y-6">
      <Dialog open={creating} onOpenChange={setCreating}>
        {/* El título cede su franja al predio (sigue para lectores): «Predios» va sobre el nombre. */}
        <PageHeader
          id="sites-title"
          title="Predios"
          description="Organizá las ubicaciones, los supervisores y las rondas de cada predio."
          className="sr-only"
        />
        {user?.role === 'admin' && (
          <DialogContent className="space-y-4">
            <DialogTitle className="text-lg font-semibold">Alta de predio</DialogTitle>
            <DialogDescription>Ingresá los datos y la ubicación del predio.</DialogDescription>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void save(event)}>
              <div className="grid gap-2">
                <Label htmlFor="site-create-clientId">Cliente</Label>
                <NativeSelect
                  id="site-create-clientId"
                  required
                  value={form.clientId}
                  onChange={(event) => {
                    setForm({ ...form, clientId: event.target.value });
                  }}
                  className="w-full"
                >
                  <NativeSelectOption value="" disabled>
                    Seleccioná un cliente
                  </NativeSelectOption>
                  {clients.data?.map((client) => (
                    <NativeSelectOption key={client.id} value={client.id}>
                      {client.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="site-create-name">Nombre</Label>
                <Input
                  id="site-create-name"
                  required
                  value={form.name}
                  onChange={(event) => {
                    setForm({ ...form, name: event.target.value });
                  }}
                  className="w-full"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="site-create-address">Dirección</Label>
                <Input
                  id="site-create-address"
                  required
                  value={form.address}
                  onChange={(event) => {
                    setForm({ ...form, address: event.target.value });
                  }}
                  className="w-full"
                />
              </div>
              <div className="sm:col-span-2">
                <SiteLocation
                  latitude={form.latitude}
                  longitude={form.longitude}
                  onChange={(latitude, longitude) => {
                    setForm({ ...form, latitude, longitude });
                  }}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="site-create-accessInstructions">Instrucciones de acceso</Label>
                <Textarea
                  id="site-create-accessInstructions"
                  value={form.accessInstructions}
                  onChange={(event) => {
                    setForm({ ...form, accessInstructions: event.target.value });
                  }}
                  className="w-full"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="site-create-observations">Observaciones</Label>
                <Textarea
                  id="site-create-observations"
                  value={form.observations}
                  onChange={(event) => {
                    setForm({ ...form, observations: event.target.value });
                  }}
                  className="w-full"
                />
              </div>
              {createError && (
                <Alert variant="destructive" className="sm:col-span-2">
                  {createError}
                </Alert>
              )}
              <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Cancelar
                  </Button>
                </DialogClose>
                <Button>Guardar predio</Button>
              </div>
            </form>
          </DialogContent>
        )}
        {actionError && <Alert variant="destructive">{actionError}</Alert>}
        {sites.isPending ? (
          <div role="status" className="space-y-3">
            <span className="sr-only">Cargando predios…</span>
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-24 w-full" />
            ))}
          </div>
        ) : sites.isError ? (
          <Alert variant="destructive">No se pudieron cargar los predios.</Alert>
        ) : sites.data.length === 0 ? (
          <EmptyState
            title="Todavía no hay predios"
            description="Los predios disponibles aparecerán acá."
            action={
              user?.role === 'admin' && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setCreating(true);
                  }}
                >
                  Nuevo predio
                </Button>
              )
            }
          />
        ) : (
          <div className="relative">
            {/* La lista es un sidebar pegado al borde, bajo la barra (52px), por encima del predio. */}
            {listOpen ? (
              <>
                <div
                  aria-hidden="true"
                  className="fixed inset-x-0 top-[52px] bottom-0 z-40 bg-bar/30"
                  onClick={() => {
                    setListOpen(false);
                  }}
                />
                <nav
                  id={listId}
                  aria-label="Lista de predios"
                  className="fixed top-[52px] bottom-0 left-0 z-50 w-80 animate-in overflow-y-auto border-r border-border bg-card p-4 duration-200 slide-in-from-left motion-reduce:animate-none"
                >
                  <div className="mb-2 flex items-center gap-2">
                    {user?.role === 'admin' && (
                      <DialogTrigger asChild>
                        <Button size="sm">
                          <Plus aria-hidden="true" />
                          Nuevo predio
                        </Button>
                      </DialogTrigger>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto"
                      aria-label="Ocultar lista de predios"
                      aria-expanded="true"
                      aria-controls={listId}
                      title="Ocultar lista de predios"
                      onClick={() => {
                        setListOpen(false);
                      }}
                    >
                      <ChevronLeft aria-hidden="true" />
                    </Button>
                  </div>
                  <ul className="border-y border-input">
                    {sites.data.map((site) => (
                      <li key={site.id} className="border-b border-border last:border-b-0">
                        <button
                          type="button"
                          aria-pressed={site.id === selected?.id}
                          onClick={() => {
                            setSelectedId(site.id);
                            setListOpen(false);
                          }}
                          className="flex min-h-14 w-full flex-col items-start justify-center px-3 py-2 text-left hover:bg-muted aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                        >
                          <span className="font-semibold break-words">{site.name}</span>
                          <span className="text-sm opacity-80">
                            {site.client?.name}
                            {site.status === 'active' ? '' : ' · Inactivo'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>
              </>
            ) : null}
            {sites.data
              .filter((site) => site.id === selected?.id)
              .map((site) => {
                const canConfigure =
                  site.status === 'active' &&
                  (user?.role === 'admin' ||
                    (user?.role === 'supervisor' &&
                      Boolean(site.supervisors?.some(({ user: u }) => u.id === user.id))));
                const assigned =
                  supervisorIds[site.id] ?? site.supervisors?.map(({ user }) => user.id) ?? [];
                return (
                  <Tabs key={site.id} defaultValue="puntos" className="gap-1">
                    <header className="space-y-1">
                      {/* La flechita y los datos del predio comparten la línea chica de «Predios». */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <button
                          type="button"
                          className="t-label flex items-center gap-1 hover:text-foreground"
                          aria-label="Mostrar lista de predios"
                          aria-expanded={listOpen}
                          aria-controls={listId}
                          title="Mostrar lista de predios"
                          onClick={() => {
                            setListOpen(true);
                          }}
                        >
                          <ChevronRight aria-hidden="true" className="size-3.5" />
                          Predios
                        </button>
                        <p className="text-xs leading-none text-muted-foreground">
                          <span>Cliente: {site.client?.name}</span> · {site.address}
                          {points.data && <> · {points.data.length} puntos</>}
                        </p>
                      </div>
                      {/* Título a la izquierda; pestañas y acciones a la derecha, todo apoyado en la misma línea de base y sin superar el alto del título. */}
                      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-3">
                          <h2 className="t-headline leading-none break-words">{site.name}</h2>
                          <StatusBadge tone={site.status === 'active' ? 'success' : 'neutral'}>
                            {site.status === 'active' ? 'Activo' : 'Inactivo'}
                          </StatusBadge>
                          {user?.role === 'admin' && !site.hasActiveSupervisor && (
                            <StatusBadge tone="neutral">Sin supervisor activo</StatusBadge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                          <TabsList className="group-data-horizontal/tabs:h-7">
                            <TabsTrigger value="puntos">Puntos de control</TabsTrigger>
                            <TabsTrigger value="rondas">Rondas</TabsTrigger>
                            <TabsTrigger value="configuracion">Configuración</TabsTrigger>
                          </TabsList>
                          {/* Cancelar y Guardar del modo edición de puntos. */}
                          <div ref={setPointActions} className="contents" />
                          {user?.role === 'admin' && site.status === 'active' && (
                            <>
                              <Button
                                variant="outline"
                                size="xs"
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
                              </Button>
                              <Button
                                variant="ghostDestructive"
                                size="xs"
                                onClick={() => {
                                  setDeleting({ id: site.id, name: site.name });
                                }}
                              >
                                Dar de baja
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </header>
                    <TabsContent value="puntos">
                      <CheckpointsPanel site={site} actions={pointActions} />
                    </TabsContent>
                    {/* Montada siempre: cambiar de pestaña no descarta una ronda a medio armar. */}
                    <TabsContent
                      value="rondas"
                      forceMount
                      className="pt-2 data-[state=inactive]:hidden"
                    >
                      <RoundsPanel site={site} />
                    </TabsContent>
                    <TabsContent value="configuracion" className="pt-2">
                      <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                        {canConfigure && (
                          <Card>
                            <CardContent>
                              <SiteConnectivityForm
                                key={`${site.id}-${String(site.connectivityType)}-${String(site.minutesToSignal)}-${String(site.marginMinutes)}`}
                                siteId={site.id}
                                initial={siteConnectivitySchema.parse({
                                  type: site.connectivityType ?? 'with_signal',
                                  minutesToSignal: site.minutesToSignal ?? 0,
                                  marginMinutes: site.marginMinutes ?? 30,
                                })}
                                onSaved={() => void sites.refetch()}
                              />
                            </CardContent>
                          </Card>
                        )}
                        <Card>
                          <CardContent>
                            <SiteSpeedConfig
                              site={site}
                              canConfigure={canConfigure}
                              onSaved={() => void sites.refetch()}
                            />
                          </CardContent>
                        </Card>
                        {user?.role === 'admin' && site.status === 'active' && (
                          <Card>
                            <CardContent>
                              <fieldset className="grid gap-1">
                                <legend className="font-cond mb-2 text-lg font-semibold tracking-wider uppercase">
                                  Supervisores asignados
                                </legend>
                                {supervisors.data?.length === 0 && (
                                  <p className="text-sm text-muted-foreground">
                                    No hay supervisores disponibles.
                                  </p>
                                )}
                                {supervisors.data?.map((supervisor) => (
                                  <label
                                    key={supervisor.id}
                                    className="flex min-h-9 items-center gap-3 text-sm"
                                  >
                                    <input
                                      type="checkbox"
                                      className="size-4 accent-primary"
                                      checked={assigned.includes(supervisor.id)}
                                      onChange={(event) => {
                                        const next = event.target.checked
                                          ? [...assigned, supervisor.id]
                                          : assigned.filter((id) => id !== supervisor.id);
                                        // Muestra la selección al instante y la revierte si el guardado falla.
                                        setSupervisorIds((current) => ({
                                          ...current,
                                          [site.id]: next,
                                        }));
                                        setActionError('');
                                        void apiPut(
                                          `/predios/${site.id}/supervisores`,
                                          { supervisorIds: next },
                                          z.object({ supervisorIds: z.array(z.string()) }),
                                          z.array(z.unknown()),
                                        )
                                          .then(() => sites.refetch())
                                          .catch((caught: unknown) => {
                                            setSupervisorIds((current) => ({
                                              ...current,
                                              [site.id]: assigned,
                                            }));
                                            setActionError(errorMessage(caught));
                                          });
                                      }}
                                    />
                                    {supervisor.firstName} {supervisor.lastName}
                                  </label>
                                ))}
                              </fieldset>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                );
              })}
          </div>
        )}
      </Dialog>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setEditError('');
          }
        }}
      >
        <DialogContent aria-describedby="site-edit-description" className="space-y-4">
          <DialogTitle className="text-lg font-semibold">Editar predio</DialogTitle>
          <DialogDescription id="site-edit-description">
            Actualizá los datos, la ubicación y las indicaciones del predio.
          </DialogDescription>
          <form
            className="grid gap-4 sm:grid-cols-2"
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
            <div className="grid gap-2">
              <Label htmlFor="site-edit-name">Nombre</Label>
              <Input
                id="site-edit-name"
                required
                value={editForm.name}
                onChange={(event) => {
                  setEditForm({ ...editForm, name: event.target.value });
                }}
                className="w-full"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="site-edit-address">Dirección</Label>
              <Input
                id="site-edit-address"
                required
                value={editForm.address}
                onChange={(event) => {
                  setEditForm({ ...editForm, address: event.target.value });
                }}
                className="w-full"
              />
            </div>
            <div className="sm:col-span-2">
              <SiteLocation
                latitude={editForm.latitude}
                longitude={editForm.longitude}
                onChange={(latitude, longitude) => {
                  setEditForm({ ...editForm, latitude, longitude });
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="site-edit-accessInstructions">Instrucciones de acceso</Label>
              <Textarea
                id="site-edit-accessInstructions"
                value={editForm.accessInstructions}
                onChange={(event) => {
                  setEditForm({ ...editForm, accessInstructions: event.target.value });
                }}
                className="w-full"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="site-edit-observations">Observaciones</Label>
              <Textarea
                id="site-edit-observations"
                value={editForm.observations}
                onChange={(event) => {
                  setEditForm({ ...editForm, observations: event.target.value });
                }}
                className="w-full"
              />
            </div>
            {editError && (
              <Alert variant="destructive" className="sm:col-span-2">
                {editError}
              </Alert>
            )}
            <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditing(null);
                }}
              >
                Cancelar
              </Button>
              <Button>Guardar cambios</Button>
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
        <AlertDialogContent className="max-h-dvh overflow-y-auto space-y-4">
          <AlertDialogTitle className="text-lg font-semibold">
            Dar de baja el predio
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground">
            Se dará de baja {deleting?.name} y se quitarán las asignaciones de supervisores.
          </AlertDialogDescription>
          {impact.isPending ? (
            <p role="status">Consultando el impacto de la baja…</p>
          ) : impact.isError ? (
            <Alert variant="destructive">
              No se pudo consultar el impacto. Cerrá el diálogo e intentá nuevamente.
            </Alert>
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
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancelar</Button>
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!impact.isSuccess}
              asChild
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
              <Button variant="destructive">Confirmar baja</Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
