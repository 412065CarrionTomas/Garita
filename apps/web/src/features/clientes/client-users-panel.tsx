import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  clientUsersSchema,
  clientUserSchema,
  createClientUserRequestSchema,
  emptyRequestSchema,
  emptyResponseSchema,
} from '@garita/shared';
import { apiGet, apiPost } from '@/lib/api-client';
import { errorMessage } from '@/lib/error-message';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';

type ClientUser = ReturnType<typeof clientUserSchema.parse>;
const initialForm = { firstName: '', lastName: '', email: '', position: '' };
const labels = {
  firstName: 'Nombre',
  lastName: 'Apellido',
  email: 'Correo',
  position: 'Cargo (opcional)',
};
const actions = {
  desactivar: 'Desactivar',
  reactivar: 'Reactivar',
  'reenviar-invitacion': 'Reenviar invitación',
};

export function ClientUsersPanel({ clientId, active }: { clientId: string; active: boolean }) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<{
    user: ClientUser;
    action: keyof typeof actions;
  } | null>(null);
  const [notice, setNotice] = useState('');
  const queryKey = ['cliente-usuarios', clientId];
  const users = useQuery({
    queryKey,
    queryFn: () => apiGet(`/clientes/${clientId}/usuarios`, clientUsersSchema),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const create = useMutation({
    mutationFn: () =>
      apiPost(
        `/clientes/${clientId}/usuarios`,
        form,
        createClientUserRequestSchema,
        clientUserSchema,
      ),
    onSuccess: async () => {
      await refresh();
      setForm(initialForm);
      setCreating(false);
      setNotice('Usuario registrado. Revisá el estado del envío en el listado.');
    },
  });
  const action = useMutation({
    mutationFn: async () => {
      if (!confirmation) return;
      const path = `/usuarios/${confirmation.user.id}/${confirmation.action}`;
      if (confirmation.action === 'reenviar-invitacion')
        await apiPost(path, {}, emptyRequestSchema, clientUserSchema);
      else await apiPost(path, {}, emptyRequestSchema, emptyResponseSchema);
    },
    onSuccess: async () => {
      await refresh();
      setConfirmation(null);
      setNotice('Acceso actualizado.');
    },
  });
  return (
    <Card aria-labelledby="client-users-title">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="client-users-title" className="text-lg font-semibold">
          Usuarios del portal
        </h2>
        <Button
          variant="outline"
          disabled={!active}
          onClick={() => {
            setErrors({});
            create.reset();
            setCreating(true);
          }}
        >
          Dar acceso
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!active && <p>El cliente está inactivo. No se pueden crear ni reactivar accesos.</p>}
        {notice && <p role="status">{notice}</p>}
        {users.isPending ? (
          <p role="status">Cargando usuarios…</p>
        ) : users.isError ? (
          <Alert variant="destructive">No se pudieron cargar los usuarios.</Alert>
        ) : users.data.length === 0 ? (
          <EmptyState
            title="Sin usuarios del portal"
            description="Dale acceso a las personas que designe este cliente."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Último ingreso</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <p>
                        {user.firstName} {user.lastName}
                      </p>
                      <p className="break-all text-muted-foreground">{user.email}</p>
                    </TableCell>
                    <TableCell>{user.position?.trim() ? user.position : '—'}</TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={
                          user.status === 'active'
                            ? 'success'
                            : user.status === 'invitation_pending'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {user.status === 'active'
                          ? 'Activo'
                          : user.status === 'invitation_pending'
                            ? 'Invitación pendiente'
                            : 'Desactivado'}
                      </StatusBadge>
                      {user.invitationStatus === 'failed' && (
                        <StatusBadge tone="danger">Envío fallido</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleString('es-AR')
                        : 'Sin ingresos'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {(Object.keys(actions) as (keyof typeof actions)[])
                          .filter((key) =>
                            key === 'reactivar'
                              ? user.status === 'deactivated'
                              : key === 'desactivar'
                                ? user.status !== 'deactivated'
                                : user.status !== 'deactivated' &&
                                  (user.status === 'invitation_pending' ||
                                    user.invitationStatus === 'failed'),
                          )
                          .map((key) => (
                            <Button
                              key={key}
                              variant="ghost"
                              size="sm"
                              disabled={!active && key !== 'desactivar'}
                              onClick={() => {
                                action.reset();
                                setConfirmation({ user, action: key });
                              }}
                            >
                              {actions[key]}
                            </Button>
                          ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogTitle>Dar acceso al portal</DialogTitle>
          <DialogDescription>
            La invitación es válida durante 72 horas y para este cliente.
          </DialogDescription>
          <form
            aria-label="Alta de usuario de cliente"
            noValidate
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = createClientUserRequestSchema.safeParse(form);
              if (!parsed.success) {
                const next: Record<string, string> = {};
                for (const issue of parsed.error.issues) {
                  const key = String(issue.path[0]);
                  next[key] =
                    key === 'email'
                      ? 'Ingresá un correo válido'
                      : key === 'position'
                        ? 'El cargo admite hasta 80 caracteres'
                        : 'Ingresá entre 2 y 60 caracteres';
                }
                setErrors(next);
                return;
              }
              setErrors({});
              create.mutate();
            }}
          >
            {(Object.keys(initialForm) as (keyof typeof initialForm)[]).map((key) => (
              <div key={key} className="grid gap-2">
                <Label htmlFor={`portal-${key}`}>{labels[key]}</Label>
                <Input
                  id={`portal-${key}`}
                  type={key === 'email' ? 'email' : 'text'}
                  required={key !== 'position'}
                  value={form[key]}
                  aria-invalid={Boolean(errors[key])}
                  aria-describedby={errors[key] ? `portal-${key}-error` : undefined}
                  onChange={(event) => {
                    setForm({ ...form, [key]: event.target.value });
                  }}
                />
                {errors[key] && (
                  <p id={`portal-${key}-error`} role="alert" className="text-sm text-danger">
                    {errors[key]}
                  </p>
                )}
              </div>
            ))}
            {create.error && (
              <Alert variant="destructive" className="sm:col-span-2">
                {errorMessage(create.error, 'El correo ya está en uso o el cliente está inactivo.')}
              </Alert>
            )}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreating(false);
                }}
              >
                Cancelar
              </Button>
              <Button disabled={create.isPending}>Enviar invitación</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !action.isPending) setConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>{confirmation ? actions[confirmation.action] : ''}</AlertDialogTitle>
          <AlertDialogDescription>
            {confirmation?.user.firstName} {confirmation?.user.lastName}:{' '}
            {confirmation?.action === 'desactivar'
              ? 'perderá el acceso al portal.'
              : confirmation?.action === 'reactivar'
                ? 'recuperará el acceso a los predios activos del cliente.'
                : 'recibirá una nueva invitación y el enlace anterior quedará invalidado.'}
          </AlertDialogDescription>
          {action.error && <Alert variant="destructive">{errorMessage(action.error)}</Alert>}
          <div className="flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="outline" disabled={action.isPending}>
                Cancelar
              </Button>
            </AlertDialogCancel>
            <Button
              variant={confirmation?.action === 'desactivar' ? 'destructive' : 'default'}
              disabled={action.isPending}
              onClick={() => {
                action.mutate();
              }}
            >
              Confirmar
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
