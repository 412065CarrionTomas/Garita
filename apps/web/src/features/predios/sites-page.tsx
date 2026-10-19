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
import { Card, CardHeader, CardContent } from '@/components/ui/card';
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
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3 border-t pt-4">
      <Label htmlFor={`speed-profile-${site.id}`} className="block text-sm font-medium">
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
      setCreating(false);
      await sites.refetch();
    } catch (caught) {
      setCreateError(errorMessage(caught, 'Ya existe un predio con ese nombre en el cliente'));
    }
  };
  return (
    <section aria-labelledby="sites-title" className="space-y-6">
      <Dialog open={creating} onOpenChange={setCreating}>
        <PageHeader
          id="sites-title"
          title="Predios"
          description="Organizá las ubicaciones, los supervisores y las rondas de cada predio."
          actions={
            user?.role === 'admin' && (
              <DialogTrigger asChild>
                <Button>Nuevo predio</Button>
              </DialogTrigger>
            )
          }
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
      </Dialog>
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
        <ul className="space-y-6">
          {sites.data.map((site) => (
            <li key={site.id}>
              <Card>
                <CardHeader className="border-b">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold break-words">{site.name}</h2>
                    <StatusBadge tone={site.status === 'active' ? 'success' : 'neutral'}>
                      {site.status === 'active' ? 'Activo' : 'Inactivo'}
                    </StatusBadge>
                  </div>
                  <p className="text-muted-foreground">
                    Cliente: {clients.data?.find((client) => client.id === site.clientId)?.name}
                  </p>
                  <p>
                    {site.address} · {site.latitude}, {site.longitude}
                  </p>
                  {site.status === 'active' && (
                    <span className="text-sm">
                      {user?.role === 'supervisor' ? 'Solo lectura' : 'Administración'}
                    </span>
                  )}
                  {user?.role === 'admin' && site.status === 'active' && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
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
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDeleting({ id: site.id, name: site.name });
                        }}
                      >
                        Dar de baja
                      </Button>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="min-w-0 space-y-6">
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
                      <div className="grid gap-2">
                        <Label htmlFor={`supervisors-${site.id}`}>Supervisores asignados</Label>
                        <NativeSelect
                          id={`supervisors-${site.id}`}
                          multiple
                          aria-label={`Supervisores de ${site.name}`}
                          value={
                            supervisorIds[site.id] ??
                            site.supervisors?.map(({ user }) => user.id) ??
                            []
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
                                setSupervisorIds((current) => ({
                                  ...current,
                                  [site.id]: previous,
                                }));
                                setActionError(errorMessage(caught));
                              });
                          }}
                          className="w-full [&>select]:h-24 [&>svg]:hidden"
                        >
                          {supervisors.data?.map((supervisor) => (
                            <NativeSelectOption key={supervisor.id} value={supervisor.id}>
                              {supervisor.firstName} {supervisor.lastName}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
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
