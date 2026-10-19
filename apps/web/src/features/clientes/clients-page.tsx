import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientInputSchema, clientsResponseSchema, clientResponseSchema } from '@garita/shared';
import { lazy, Suspense, useState } from 'react';
import { useParams } from 'react-router';
import { apiGet, apiPost, apiPatch, ApiError } from '@/lib/api-client';
import { env } from '@/config/env';
import { errorMessage } from '@/lib/error-message';
import { z } from 'zod';
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
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';

const response = z.looseObject({ id: z.string() });
const ClientSitesMap = lazy(() =>
  import('../mapa/site-location-map').then((module) => ({ default: module.ClientSitesMap })),
);
export function ClientsPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
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
      setCreating(false);
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
  const impact = useQuery({
    queryKey: ['cliente-impacto-baja', deleting?.id],
    enabled: deleting !== null,
    queryFn: () =>
      apiGet(
        `/clientes/${deleting?.id ?? ''}/impacto-baja`,
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
  return (
    <section aria-labelledby="clients-title" className="space-y-6">
      <Dialog open={creating} onOpenChange={setCreating}>
        <PageHeader
          id="clients-title"
          title="Clientes"
          description="Administrá los datos de contacto y los predios de tus clientes."
          actions={
            <DialogTrigger asChild>
              <Button>Nuevo cliente</Button>
            </DialogTrigger>
          }
        />
        <DialogContent className="space-y-4">
          <DialogTitle className="text-lg font-semibold">Nuevo cliente</DialogTitle>
          <DialogDescription>Ingresá los datos del cliente y su contacto.</DialogDescription>
          <form
            className="grid gap-4 sm:grid-cols-2"
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
              <div key={key} className="grid gap-2">
                <Label htmlFor={`client-create-${key}`}>
                  {
                    {
                      name: 'Nombre o razón social',
                      contactName: 'Persona de contacto',
                      phone: 'Teléfono',
                      email: 'Correo',
                      taxId: 'CUIT (opcional)',
                    }[key]
                  }
                </Label>
                <Input
                  id={`client-create-${key}`}
                  required={key !== 'taxId'}
                  type={key === 'email' ? 'email' : 'text'}
                  value={form[key]}
                  onChange={(event) => {
                    setForm({ ...form, [key]: event.target.value });
                  }}
                />
              </div>
            ))}
            <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancelar
                </Button>
              </DialogClose>
              <Button>Registrar cliente</Button>
            </div>
            {error && (
              <Alert variant="destructive" className="sm:col-span-2">
                {error}
              </Alert>
            )}
          </form>
          {create.error && (
            <Alert variant="destructive">
              {create.error instanceof ApiError && create.error.status === 409
                ? 'Ya existe un cliente con ese nombre'
                : create.error.message}
            </Alert>
          )}
        </DialogContent>
      </Dialog>
      {actionError && <Alert variant="destructive">{actionError}</Alert>}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Listado</h2>
        </CardHeader>
        <CardContent>
          {clients.isPending ? (
            <div role="status" className="space-y-3">
              <span className="sr-only">Cargando clientes…</span>
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-12 w-full" />
              ))}
            </div>
          ) : clients.isError ? (
            <Alert variant="destructive">No se pudieron cargar los clientes.</Alert>
          ) : clients.data.length === 0 ? (
            <EmptyState
              title="Todavía no hay clientes"
              description="Registrá un cliente para empezar a organizar sus predios."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setCreating(true);
                  }}
                >
                  Nuevo cliente
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.data.map((client) => (
                    <TableRow key={client.id}>
                      <TableCell className="whitespace-normal">
                        <div className="min-w-40">
                          <strong>
                            <a className="underline" href={`/clientes/${client.id}`}>
                              {client.name}
                            </a>
                          </strong>
                          <p>
                            {client.contactName} · {client.phone} · {client.email}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={client.status === 'active' ? 'success' : 'neutral'}>
                          {client.status === 'active' ? 'Activo' : 'Inactivo'}
                        </StatusBadge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
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
                          </Button>
                          <Button
                            variant="ghostDestructive"
                            size="sm"
                            onClick={() => {
                              setDeleting({ id: client.id, name: client.name });
                            }}
                          >
                            Dar de baja
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setEditError('');
          }
        }}
      >
        <DialogContent aria-describedby="client-edit-description" className="space-y-4">
          <DialogTitle className="text-lg font-semibold">Editar cliente</DialogTitle>
          <DialogDescription id="client-edit-description">
            Actualizá todos los datos del cliente.
          </DialogDescription>
          <form
            className="grid gap-4 sm:grid-cols-2"
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
              <div key={key} className="grid gap-2">
                <Label htmlFor={`client-edit-${key}`}>
                  {
                    {
                      name: 'Nombre o razón social',
                      contactName: 'Persona de contacto',
                      phone: 'Teléfono',
                      email: 'Correo',
                      taxId: 'CUIT (opcional)',
                    }[key]
                  }
                </Label>
                <Input
                  id={`client-edit-${key}`}
                  required={key !== 'taxId'}
                  type={key === 'email' ? 'email' : 'text'}
                  value={editForm[key]}
                  onChange={(event) => {
                    setEditForm({ ...editForm, [key]: event.target.value });
                  }}
                />
              </div>
            ))}
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
            Dar de baja al cliente
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground">
            La baja de {deleting?.name} también dará de baja sus predios y quitará todas las
            asignaciones de supervisores.
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
                    `/clientes/${deleting.id}/baja`,
                    { confirm: true },
                    z.object({ confirm: z.boolean() }),
                    response,
                  )
                    .then(() => queryClient.invalidateQueries({ queryKey: ['clientes'] }))
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

export function ClientDetailPage() {
  const { id } = useParams();
  const client = useQuery({
    queryKey: ['cliente', id],
    queryFn: () => apiGet(`/clientes/${id ?? ''}`, clientResponseSchema),
    enabled: Boolean(id),
  });
  if (client.isPending) return <p role="status">Cargando ficha…</p>;
  if (client.isError)
    return <Alert variant="destructive">No se pudo cargar la ficha del cliente.</Alert>;
  const activeSites = client.data.sites.filter((site) => site.status === 'active');
  return (
    <section aria-labelledby="client-title" className="space-y-6">
      <Button variant="link" asChild>
        <a href="/clientes">Volver a Clientes</a>
      </Button>
      <PageHeader
        id="client-title"
        title={client.data.name}
        actions={
          <StatusBadge tone={client.data.status === 'active' ? 'success' : 'neutral'}>
            {client.data.status === 'active' ? 'Activo' : 'Inactivo'}
          </StatusBadge>
        }
      />
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Datos de contacto</h2>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Persona de contacto</dt>
              <dd>{client.data.contactName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Teléfono</dt>
              <dd className="tabular-nums">{client.data.phone}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Correo</dt>
              <dd className="break-all">{client.data.email}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Predios activos</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          {env.VITE_GOOGLE_MAPS_API_KEY ? (
            <Suspense fallback={<p role="status">Cargando mapa…</p>}>
              <ClientSitesMap sites={activeSites} />
            </Suspense>
          ) : (
            <Alert role="status" className="bg-info-soft text-info">
              El mapa no está configurado; coordenadas disponibles para carga y consulta manual.
            </Alert>
          )}
          {activeSites.length === 0 ? (
            <EmptyState
              title="Este cliente no tiene predios activos."
              description="Los predios activos del cliente aparecerán acá."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Predio</TableHead>
                    <TableHead>Dirección</TableHead>
                    <TableHead>Coordenadas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeSites.map((site) => (
                    <TableRow key={site.id}>
                      <TableCell>{site.name}</TableCell>
                      <TableCell>{site.address}</TableCell>
                      <TableCell className="tabular-nums">
                        {site.latitude}, {site.longitude}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
