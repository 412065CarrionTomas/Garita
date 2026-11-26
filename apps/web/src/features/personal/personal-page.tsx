import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { EllipsisVertical, Search } from 'lucide-react';
import { z } from 'zod';
import {
  GUARD_LIMIT_REACHED_CODE,
  createUserRequestSchema,
  emptyRequestSchema,
  emptyResponseSchema,
  personnelUserSchema,
  SHIFT_EXECUTION_ERROR_CODES,
  updateUserRequestSchema,
  usersPageSchema,
} from '@garita/shared';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { lastPage } from '@/lib/page-items';
import { useBusy } from '@/lib/use-busy';
import { useDebouncedSearch } from '@/lib/use-debounced-search';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/empty-state';
import { DataTable } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { SegmentedFilter } from '@/components/segmented-filter';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '../auth/auth-context';
import { loadAvailableGuards } from './available-guards';

type Person = ReturnType<typeof personnelUserSchema.parse>;

interface InProgressShift {
  id?: string;
  startsAt: string;
  endsAt: string;
  site: {
    name: string;
    company?: { timezone?: string };
  };
  timezone?: string;
}

const inProgressShiftSchema = z.looseObject({
  id: z.string().optional(),
  startsAt: z.string(),
  endsAt: z.string(),
  site: z.looseObject({
    name: z.string(),
    company: z.looseObject({ timezone: z.string().optional() }).optional(),
  }),
  timezone: z.string().optional(),
});

const guardHasShiftInProgressConflictSchema = z.looseObject({
  code: z.literal(SHIFT_EXECUTION_ERROR_CODES.guardHasShiftInProgress),
  shiftId: z.string().optional(),
  shift: inProgressShiftSchema.optional(),
});

const SUMMARY = [
  { value: 'active', label: 'Activos' },
  { value: 'invitation_pending', label: 'Invitaciones pendientes' },
  { value: 'invitation_failed', label: 'Envíos fallidos' },
  { value: 'deactivated', label: 'Desactivados' },
] as const;

const ROLE_FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'guard', label: 'Vigiladores' },
  { value: 'supervisor', label: 'Supervisores' },
];

function formatInCompanyTimezone(value: string, timezone?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-AR', {
    timeZone: timezone ?? 'America/Argentina/Buenos_Aires',
  });
}

export function PersonalPage() {
  const { user } = useAuth();
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // Busca solo cuando se deja de tipear, sin botón de buscar.
  const { input: searchInput, setInput: setSearchInput, search } = useDebouncedSearch(setPage);
  const [order, setOrder] = useState('recientes');
  const [creating, setCreating] = useState(false);
  const { busy, run } = useBusy();
  const [editing, setEditing] = useState<Person | null>(null);
  const [deactivating, setDeactivating] = useState<Person | null>(null);
  const [deriveToUserId, setDeriveToUserId] = useState('');
  const [leaveUnassigned, setLeaveUnassigned] = useState(false);
  const [notDerived, setNotDerived] = useState<{ id: string; name: string }[]>([]);
  const [inProgressShift, setInProgressShift] = useState<InProgressShift | null>(null);
  const [forceReason, setForceReason] = useState('');
  const [forceReasonError, setForceReasonError] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [guardLimitTrial, setGuardLimitTrial] = useState<boolean | null>(null);
  const handleGuardLimit = (error: unknown): boolean => {
    const parsed = z
      .object({
        code: z.literal(GUARD_LIMIT_REACHED_CODE),
        message: z.string(),
        status: z.string(),
      })
      .safeParse(error instanceof ApiError ? error.body : null);
    if (!(error instanceof ApiError) || error.status !== 409 || !parsed.success) return false;
    setFormError(parsed.data.message);
    setGuardLimitTrial(parsed.data.status === 'trial');
    return true;
  };
  const reasonInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const futureShifts = useQuery({
    queryKey: ['personal', deactivating?.id, 'turnos-futuros'],
    enabled: deactivating?.role === 'guard',
    queryFn: () =>
      apiGet(
        `/usuarios/${deactivating?.id ?? ''}/turnos-futuros`,
        z.array(
          z.looseObject({
            id: z.string(),
            startsAt: z.string(),
            endsAt: z.string(),
            site: z.looseObject({ name: z.string() }),
          }),
        ),
      ),
  });
  const guardOptions = useQuery({
    queryKey: ['personal', 'vigiladores', 'derivacion'],
    enabled: deactivating?.role === 'guard',
    queryFn: loadAvailableGuards,
  });
  const params = new URLSearchParams({
    pagina: String(page),
    porPagina: String(pageSize),
    orden: order,
  });
  if (role) params.set('rol', role);
  if (status) params.set('estado', status);
  if (search) params.set('buscar', search);
  const result = useQuery({
    queryKey: ['personal', role, status, search, order, page, pageSize],
    queryFn: () => apiGet(`/usuarios?${params.toString()}`, usersPageSchema),
    // Mantiene la tabla mientras llega la página nueva: buscar no parpadea.
    placeholderData: keepPreviousData,
  });
  // Se quitó lo último de la página (p. ej. una baja): volver a la última que tenga resultados.
  const total = result.data?.total;
  if (total !== undefined && !result.isPlaceholderData && page > lastPage(total, pageSize)) {
    setPage(lastPage(total, pageSize));
  }
  const changeStatus = (value: string) => {
    setStatus(value);
    setPage(1);
  };
  useEffect(() => {
    if (inProgressShift && reasonInputRef.current) {
      reasonInputRef.current.focus();
    }
  }, [inProgressShift]);
  const refresh = async () => queryClient.invalidateQueries({ queryKey: ['personal'] });
  const closeDeactivateDialog = () => {
    setDeactivating(null);
    setDeriveToUserId('');
    setLeaveUnassigned(false);
    setNotDerived([]);
    setInProgressShift(null);
    setForceReason('');
    setForceReasonError('');
    setDialogError('');
  };
  const handleDeactivateError = async (error: unknown, fallbackMessage: string) => {
    if (error instanceof ApiError && error.status === 409) {
      const conflict = guardHasShiftInProgressConflictSchema.safeParse(error.body);
      if (conflict.success) {
        if (conflict.data.shift) {
          setInProgressShift(conflict.data.shift);
        } else if (conflict.data.shiftId) {
          try {
            const shiftData = await apiGet(
              `/turnos/${conflict.data.shiftId}`,
              inProgressShiftSchema,
            );
            setInProgressShift(shiftData);
          } catch {
            setInProgressShift({
              id: conflict.data.shiftId,
              startsAt: '',
              endsAt: '',
              site: { name: 'Predio asignado' },
            });
          }
        } else {
          setInProgressShift({
            startsAt: '',
            endsAt: '',
            site: { name: 'Predio asignado' },
          });
        }
        setForceReason('');
        setForceReasonError('');
        setDialogError('');
        return;
      }
    }
    setDialogError(fallbackMessage);
    setFormError(fallbackMessage);
  };
  const submitForceDeactivate = async () => {
    if (!deactivating) return;
    const trimmedReason = forceReason.trim();
    if (trimmedReason.length < 3) {
      setForceReasonError('El motivo es obligatorio y debe tener al menos 3 caracteres.');
      reasonInputRef.current?.focus();
      return;
    }
    setForceReasonError('');
    setDialogError('');

    const body: Record<string, unknown> = {
      forceDeactivate: true,
      reason: trimmedReason,
    };

    if (deriveToUserId) {
      body.deriveToUserId = deriveToUserId;
    } else if (leaveUnassigned && futureShifts.data) {
      body.leaveUnassigned = true;
      body.confirmUnassignedCount = futureShifts.data.length;
    }

    try {
      const result = await apiPost(
        `/usuarios/${deactivating.id}/desactivar`,
        body,
        z.union([
          z.object({ forceDeactivate: z.literal(true), reason: z.string().trim().min(3) }),
          z.object({
            forceDeactivate: z.literal(true),
            reason: z.string().trim().min(3),
            deriveToUserId: z.string().min(1),
          }),
          z.object({
            forceDeactivate: z.literal(true),
            reason: z.string().trim().min(3),
            leaveUnassigned: z.literal(true),
            confirmUnassignedCount: z.number().int().nonnegative(),
          }),
        ]),
        z.looseObject({
          notDerived: z
            .array(
              z.looseObject({
                id: z.string(),
                site: z.looseObject({ name: z.string() }),
              }),
            )
            .optional()
            .default([]),
        }),
      );
      if (result.notDerived.length > 0) {
        setNotDerived(result.notDerived.map(({ id, site }) => ({ id, name: site.name })));
        await refresh();
      } else {
        closeDeactivateDialog();
        await refresh();
      }
    } catch (error: unknown) {
      await handleDeactivateError(error, 'No se pudo desactivar el usuario.');
    }
  };
  const runAction = async (
    path: string,
    failure: string,
    responseSchema: z.ZodType = emptyResponseSchema,
  ) => {
    try {
      setGuardLimitTrial(null);
      await apiPost(path, {}, emptyRequestSchema, responseSchema);
      setFormError('');
      await refresh();
    } catch (error: unknown) {
      if (handleGuardLimit(error)) return;
      setFormError(failure);
    }
  };
  const saveEdit = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    return run(() => saveEditNow(event));
  };
  const saveEditNow = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    if (!editing) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = updateUserRequestSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      return;
    }
    try {
      await apiPatch(
        `/usuarios/${editing.id}`,
        parsed.data,
        updateUserRequestSchema,
        personnelUserSchema,
      );
      setEditing(null);
      setErrors({});
      setFormError('');
      await refresh();
    } catch {
      setFormError('No se pudo editar el registro.');
    }
  };
  return (
    <section aria-labelledby="personal-title" className="min-w-0 space-y-6">
      <PageHeader
        id="personal-title"
        title="Personal"
        description="Usuarios de tu empresa. Los clientes solo ven su predio."
        actions={
          user?.role === 'admin' && (
            <Button
              type="button"
              onClick={() => {
                setCreating(!creating);
                setFormError('');
              }}
            >
              Invitar usuario
            </Button>
          )
        }
      />
      {result.data && (
        <div role="group" aria-label="Resumen del personal" className="flex flex-wrap gap-2">
          {SUMMARY.map(({ value, label }) => {
            const count = result.data.resumen[value];
            const pressed = status === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={pressed}
                onClick={() => {
                  changeStatus(pressed ? '' : value);
                }}
                className={cn(
                  'flex min-h-9 items-baseline gap-2 rounded-md border-[1.5px] px-3 py-1.5 text-sm transition-colors',
                  pressed
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-card hover:bg-muted',
                  !pressed &&
                    value === 'invitation_failed' &&
                    count > 0 &&
                    'border-danger text-danger',
                )}
              >
                <span className="text-base font-semibold tabular-nums">{count}</span>
                {label}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Buscar personal"
            placeholder="Buscar por nombre, correo o legajo"
            className="pl-9"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
            }}
          />
        </div>
        <SegmentedFilter
          ariaLabel="Filtrar por rol"
          options={ROLE_FILTERS}
          value={role}
          onChange={(value) => {
            setRole(value);
            setPage(1);
          }}
        />
        <NativeSelect
          aria-label="Filtrar por estado"
          value={status}
          onChange={(event) => {
            changeStatus(event.target.value);
          }}
        >
          <NativeSelectOption value="">Todos los estados</NativeSelectOption>
          <NativeSelectOption value="active">Activo</NativeSelectOption>
          <NativeSelectOption value="invitation_pending">Invitación pendiente</NativeSelectOption>
          <NativeSelectOption value="invitation_failed">Envío fallido</NativeSelectOption>
          <NativeSelectOption value="deactivated">Desactivado</NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          aria-label="Ordenar por"
          value={order}
          onChange={(event) => {
            setOrder(event.target.value);
            setPage(1);
          }}
        >
          <NativeSelectOption value="recientes">Más recientes</NativeSelectOption>
          <NativeSelectOption value="nombre">Nombre (A–Z)</NativeSelectOption>
          <NativeSelectOption value="estado">Estado</NativeSelectOption>
        </NativeSelect>
      </div>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="space-y-4">
          <DialogTitle className="text-lg font-semibold">Invitar usuario</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Completá los datos y enviamos la invitación por correo.
          </DialogDescription>
          <form
            aria-label="Invitar usuario"
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = createUserRequestSchema.safeParse(
                Object.fromEntries(new FormData(event.currentTarget)),
              );
              if (!parsed.success) {
                setErrors(
                  Object.fromEntries(
                    parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
                  ),
                );
                return;
              }
              setErrors({});
              setGuardLimitTrial(null);
              setFormError('');
              void run(() =>
                apiPost('/usuarios', parsed.data, createUserRequestSchema, personnelUserSchema)
                  .then(async () => {
                    await refresh();
                    setCreating(false);
                  })
                  .catch((error: unknown) => {
                    if (handleGuardLimit(error)) return;
                    setFormError(
                      error instanceof ApiError && error.status === 409
                        ? 'Ese correo ya está en uso'
                        : 'No se pudo crear la invitación.',
                    );
                  }),
              );
            }}
          >
            {(['firstName', 'lastName', 'email', 'phone', 'employeeNumber'] as const).map(
              (field) => (
                <Label htmlFor={`create-${field}`} key={field} className="grid gap-1">
                  {
                    {
                      firstName: 'Nombre',
                      lastName: 'Apellido',
                      email: 'Correo',
                      phone: 'Teléfono celular',
                      employeeNumber: 'Legajo',
                    }[field]
                  }
                  <Input
                    id={`create-${field}`}
                    name={field}
                    type={field === 'email' ? 'email' : 'text'}
                    aria-invalid={Boolean(errors[field])}
                    aria-describedby={errors[field] ? `${field}-error` : undefined}
                    className="w-full"
                  />
                  {errors[field] && (
                    <span id={`${field}-error`} className="text-sm text-danger">
                      {errors[field]}
                    </span>
                  )}
                </Label>
              ),
            )}
            <Label className="grid gap-1">
              Rol
              <NativeSelect name="role" className="w-full">
                <NativeSelectOption value="guard">Vigilador</NativeSelectOption>
                <NativeSelectOption value="supervisor">Supervisor</NativeSelectOption>
              </NativeSelect>
            </Label>
            <div className="flex flex-wrap justify-end gap-3 sm:col-span-2">
              {formError && (
                <Alert variant="destructive" role="alert">
                  {formError}
                  {guardLimitTrial !== null && user?.role === 'admin' && (
                    <a href="/suscripcion" className="font-semibold underline">
                      {guardLimitTrial ? 'Suscribirme' : 'Cambiar de plan'}
                    </a>
                  )}
                </Alert>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreating(false);
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                Enviar invitación
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {result.isPending ? (
        <div role="status" className="space-y-3">
          <span className="sr-only">Cargando personal…</span>
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-10 w-full" />
          ))}
        </div>
      ) : result.isError ? (
        <Alert variant="destructive" role="alert">
          No se pudo cargar el personal.
        </Alert>
      ) : (
        <div className="space-y-4">
          {result.data.items.length === 0 ? (
            <EmptyState
              title="No hay personal para mostrar"
              description="Revisá los filtros o agregá personal a tu empresa."
              action={
                user?.role === 'admin' ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCreating(true);
                    }}
                  >
                    Invitar usuario
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto border-[1.5px] border-input">
              <DataTable
                label="Personal"
                sortable={false}
                rows={result.data.items}
                getRowId={(p) => p.id}
                columns={[
                  {
                    id: 'name',
                    header: 'Nombre',
                    cell: (p) => (
                      <>
                        <strong className="block truncate font-semibold">
                          {p.firstName} {p.lastName}
                        </strong>
                        <span className="block truncate text-sm text-muted-foreground">
                          {p.email}
                        </span>
                      </>
                    ),
                  },
                  {
                    id: 'phone',
                    header: 'Teléfono',
                    width: 176,
                    cell: (p) =>
                      p.phone ? (
                        <a
                          href={`tel:${p.phone.replaceAll(' ', '')}`}
                          className="tabular-nums hover:underline"
                        >
                          {p.phone}
                        </a>
                      ) : (
                        '—'
                      ),
                  },
                  {
                    id: 'employeeNumber',
                    header: 'Legajo',
                    width: 112,
                    className: 'tabular-nums',
                    cell: (p) => p.employeeNumber ?? '—',
                  },
                  {
                    id: 'role',
                    header: 'Rol',
                    width: 128,
                    cell: (p) => (p.role === 'guard' ? 'Vigilador' : 'Supervisor'),
                  },
                  {
                    id: 'status',
                    header: 'Estado',
                    width: 176,
                    cell: (p) => (
                      <StatusBadge
                        tone={
                          p.status === 'active'
                            ? 'success'
                            : p.status === 'invitation_pending'
                              ? p.invitationStatus === 'failed'
                                ? 'danger'
                                : 'warning'
                              : 'neutral'
                        }
                      >
                        {p.status === 'invitation_pending'
                          ? p.invitationStatus === 'failed'
                            ? 'Envío fallido'
                            : 'Invitación enviada'
                          : p.status === 'active'
                            ? 'Activo'
                            : 'Desactivado'}
                      </StatusBadge>
                    ),
                  },
                  // Solo el administrador gestiona al personal.
                  ...(user?.role === 'admin'
                    ? [
                        {
                          id: 'actions',
                          header: 'Acciones',
                          hideHeader: true,
                          width: 64,
                          align: 'right' as const,
                          cell: (p: (typeof result.data.items)[number]) => (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Más acciones de ${p.firstName} ${p.lastName}`}
                                >
                                  <EllipsisVertical aria-hidden="true" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-auto">
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setEditing(p);
                                    setErrors({});
                                    setFormError('');
                                  }}
                                >
                                  Editar
                                </DropdownMenuItem>
                                {p.status === 'invitation_pending' && (
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      void runAction(
                                        `/usuarios/${p.id}/reenviar-invitacion`,
                                        'No se pudo reenviar la invitación.',
                                        personnelUserSchema,
                                      )
                                    }
                                  >
                                    Reenviar invitación
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                {p.status === 'deactivated' ? (
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      void runAction(
                                        `/usuarios/${p.id}/reactivar`,
                                        'No se pudo reactivar el usuario.',
                                      )
                                    }
                                  >
                                    Reactivar
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={() => {
                                      setDeactivating(p);
                                      setDeriveToUserId('');
                                      setLeaveUnassigned(false);
                                      setNotDerived([]);
                                      setInProgressShift(null);
                                      setForceReason('');
                                      setForceReasonError('');
                                      setDialogError('');
                                      setFormError('');
                                    }}
                                  >
                                    Desactivar
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          )}
          <Pagination
            page={page}
            pageSize={pageSize}
            total={result.data.total}
            shown={result.data.items.length}
            label="personal"
            onPage={setPage}
            onPageSize={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </div>
      )}
      {formError && !creating && !editing && (
        <Alert variant="destructive" role="alert">
          {formError}
          {guardLimitTrial !== null && user?.role === 'admin' && (
            <a href="/suscripcion" className="font-semibold underline">
              {guardLimitTrial ? 'Suscribirme' : 'Cambiar de plan'}
            </a>
          )}
        </Alert>
      )}
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing && (
          <DialogContent
            aria-labelledby="edit-title"
            aria-describedby="edit-description"
            className="space-y-4"
          >
            <form
              aria-label="Editar personal"
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => void saveEdit(event)}
            >
              <DialogTitle id="edit-title" className="text-lg font-semibold sm:col-span-2">
                Editar personal
              </DialogTitle>
              <DialogDescription
                id="edit-description"
                className="text-sm text-muted-foreground sm:col-span-2"
              >
                Actualizá nombre, apellido, teléfono o legajo.
              </DialogDescription>
              {(['firstName', 'lastName', 'phone', 'employeeNumber'] as const).map((field) => (
                <Label htmlFor={`edit-${field}`} key={field} className="grid gap-1">
                  {
                    {
                      firstName: 'Nombre',
                      lastName: 'Apellido',
                      phone: 'Teléfono celular',
                      employeeNumber: 'Legajo',
                    }[field]
                  }
                  <Input
                    id={`edit-${field}`}
                    name={field}
                    defaultValue={editing[field] ?? ''}
                    aria-invalid={Boolean(errors[field])}
                    aria-describedby={errors[field] ? `${field}-error` : undefined}
                    className="w-full"
                  />
                  {errors[field] && (
                    <span id={`${field}-error`} className="text-sm text-danger">
                      {errors[field]}
                    </span>
                  )}
                </Label>
              ))}
              {formError && (
                <Alert variant="destructive" role="alert">
                  {formError}
                  {guardLimitTrial !== null && user?.role === 'admin' && (
                    <a href="/suscripcion" className="font-semibold underline">
                      {guardLimitTrial ? 'Suscribirme' : 'Cambiar de plan'}
                    </a>
                  )}
                </Alert>
              )}
              <div className="flex flex-wrap justify-end gap-3 sm:col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditing(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={busy}>
                  Guardar cambios
                </Button>
              </div>
            </form>
          </DialogContent>
        )}
      </Dialog>
      <Dialog
        open={Boolean(deactivating)}
        onOpenChange={(open) => {
          if (!open) closeDeactivateDialog();
        }}
      >
        {deactivating && (
          <DialogContent
            aria-labelledby="deactivate-title"
            aria-describedby="deactivate-description"
            className="space-y-4"
          >
            <DialogTitle id="deactivate-title" className="text-lg font-semibold">
              Desactivar usuario
            </DialogTitle>
            <DialogDescription
              id="deactivate-description"
              className="text-sm text-muted-foreground"
            >
              ¿Querés desactivar a {deactivating.firstName} {deactivating.lastName}? Ya no podrá
              acceder a Garita.
            </DialogDescription>
            {deactivating.role === 'guard' &&
              (futureShifts.isPending ? (
                <p role="status">Consultando turnos futuros…</p>
              ) : futureShifts.isError ? (
                <Alert variant="destructive" role="alert">
                  No se pudieron consultar los turnos futuros.
                </Alert>
              ) : (
                <div className="mt-4 space-y-3">
                  {futureShifts.data.length > 0 ? (
                    <>
                      <p>Tiene {futureShifts.data.length} turnos futuros:</p>
                      <ul className="max-h-40 list-disc overflow-auto pl-5">
                        {futureShifts.data.map((shift) => (
                          <li key={shift.id}>
                            {shift.site.name} · {new Date(shift.startsAt).toLocaleString('es-AR')}–
                            {new Date(shift.endsAt).toLocaleString('es-AR')}
                          </li>
                        ))}
                      </ul>
                      <Label className="grid gap-1">
                        Derivar turnos a
                        <NativeSelect
                          className="w-full"
                          value={deriveToUserId}
                          onChange={(event) => {
                            setDeriveToUserId(event.target.value);
                            setLeaveUnassigned(false);
                          }}
                        >
                          <NativeSelectOption value="">
                            Seleccioná un vigilador destino
                          </NativeSelectOption>
                          {guardOptions.data?.items
                            .filter(
                              (candidate) =>
                                candidate.id !== deactivating.id &&
                                (candidate.status === 'active' ||
                                  candidate.status === 'invitation_pending'),
                            )
                            .map((candidate) => (
                              <NativeSelectOption key={candidate.id} value={candidate.id}>
                                {candidate.firstName} {candidate.lastName}
                                {candidate.status === 'invitation_pending'
                                  ? ' · invitación pendiente'
                                  : ''}
                              </NativeSelectOption>
                            ))}
                        </NativeSelect>
                      </Label>
                      <Label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={leaveUnassigned}
                          onChange={(event) => {
                            setLeaveUnassigned(event.target.checked);
                            setDeriveToUserId('');
                          }}
                        />
                        <span>Dejar los turnos sin vigilador</span>
                      </Label>
                      {leaveUnassigned && (
                        <Alert className="border-warning bg-warning-soft text-warning" role="alert">
                          Se desactivará a {deactivating.firstName} y {futureShifts.data.length}{' '}
                          turnos quedarán sin vigilador. Si nadie los cubre, sus rondas contarán
                          como no realizadas. Confirmá esta cantidad en una segunda instancia.
                        </Alert>
                      )}
                      {notDerived.length > 0 && (
                        <Alert
                          role="status"
                          className="border-warning bg-warning-soft text-warning"
                        >
                          <p>
                            {notDerived.length} turnos no se pudieron derivar por superposición:
                          </p>
                          <ul className="list-disc pl-5">
                            {notDerived.map((shift) => (
                              <li key={shift.id}>{shift.name}</li>
                            ))}
                          </ul>
                        </Alert>
                      )}
                    </>
                  ) : (
                    <p>No tiene turnos futuros.</p>
                  )}
                </div>
              ))}
            {inProgressShift && (
              <Alert
                className="space-y-3 border-warning bg-warning-soft text-warning"
                role="region"
                aria-label="Turno en curso"
              >
                <p className="font-semibold text-warning">Turno en curso:</p>
                <ul className="list-disc pl-5 text-warning space-y-1">
                  <li>
                    <strong>Predio:</strong> {inProgressShift.site.name}
                  </li>
                  <li>
                    <strong>Inicio:</strong>{' '}
                    {formatInCompanyTimezone(
                      inProgressShift.startsAt,
                      inProgressShift.site.company?.timezone ?? inProgressShift.timezone,
                    )}
                  </li>
                  <li>
                    <strong>Fin:</strong>{' '}
                    {formatInCompanyTimezone(
                      inProgressShift.endsAt,
                      inProgressShift.site.company?.timezone ?? inProgressShift.timezone,
                    )}
                  </li>
                </ul>
                <p className="font-medium text-warning">
                  El turno se cerrará ahora como un cierre antes de hora del administrador y quedará
                  sin cobertura.
                </p>
                {/* HU-13: Eventos pendientes que informó el celular (pendiente de integración en HU-13) */}
                <Label
                  htmlFor="force-deactivate-reason"
                  className="mt-3 grid gap-1 text-foreground"
                >
                  <span>Motivo de desactivación</span>
                  <Input
                    ref={reasonInputRef}
                    id="force-deactivate-reason"
                    name="forceDeactivateReason"
                    type="text"
                    value={forceReason}
                    onChange={(event) => {
                      setForceReason(event.target.value);
                      if (forceReasonError && event.target.value.trim().length >= 3) {
                        setForceReasonError('');
                      }
                    }}
                    aria-invalid={Boolean(forceReasonError)}
                    aria-describedby={
                      forceReasonError ? 'force-deactivate-reason-error' : undefined
                    }
                    className="w-full"
                    placeholder="Indicá el motivo (mínimo 3 caracteres)"
                  />
                  {forceReasonError && (
                    <span
                      id="force-deactivate-reason-error"
                      className="text-sm text-danger"
                      role="alert"
                    >
                      {forceReasonError}
                    </span>
                  )}
                </Label>
              </Alert>
            )}
            {dialogError && (
              <Alert variant="destructive" role="alert">
                {dialogError}
              </Alert>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="outline" onClick={closeDeactivateDialog}>
                Cancelar
              </Button>
              {inProgressShift ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void submitForceDeactivate()}
                >
                  Desactivar igual
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    disabled={
                      deactivating.role === 'guard' &&
                      (futureShifts.isPending ||
                        futureShifts.isError ||
                        futureShifts.data.length > 0)
                    }
                    variant="destructive"
                    onClick={() => {
                      const person = deactivating;
                      setDialogError('');
                      void apiPost(
                        `/usuarios/${person.id}/desactivar`,
                        {},
                        emptyRequestSchema,
                        emptyResponseSchema,
                      )
                        .then(async () => {
                          closeDeactivateDialog();
                          await refresh();
                        })
                        .catch(async (error: unknown) => {
                          await handleDeactivateError(error, 'No se pudo desactivar el usuario.');
                        });
                    }}
                  >
                    Confirmar desactivación
                  </Button>
                  {deactivating.role === 'guard' && deriveToUserId && (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => {
                        setDialogError('');
                        void apiPost(
                          `/usuarios/${deactivating.id}/desactivar`,
                          { deriveToUserId },
                          z.object({ deriveToUserId: z.string() }),
                          z.looseObject({
                            notDerived: z.array(
                              z.looseObject({
                                id: z.string(),
                                site: z.looseObject({ name: z.string() }),
                              }),
                            ),
                          }),
                        )
                          .then(async (result) => {
                            setNotDerived(
                              result.notDerived.map(({ id, site }) => ({ id, name: site.name })),
                            );
                            await refresh();
                            if (result.notDerived.length === 0) closeDeactivateDialog();
                          })
                          .catch(async (error: unknown) => {
                            await handleDeactivateError(
                              error,
                              'No se pudieron derivar los turnos. Revisá las superposiciones.',
                            );
                          });
                      }}
                    >
                      Derivar y desactivar
                    </Button>
                  )}
                  {deactivating.role === 'guard' && leaveUnassigned && futureShifts.data && (
                    <Button
                      type="button"
                      variant="destructive"
                      className="h-auto min-h-9 whitespace-normal text-center"
                      onClick={() => {
                        setDialogError('');
                        void apiPost(
                          `/usuarios/${deactivating.id}/desactivar`,
                          {
                            leaveUnassigned: true,
                            confirmUnassignedCount: futureShifts.data.length,
                          },
                          z.object({
                            leaveUnassigned: z.literal(true),
                            confirmUnassignedCount: z.number().int().nonnegative(),
                          }),
                          z.looseObject({}),
                        )
                          .then(async () => {
                            closeDeactivateDialog();
                            await refresh();
                          })
                          .catch(async (error: unknown) => {
                            await handleDeactivateError(
                              error,
                              'No se pudo desactivar al vigilador con esa confirmación. Actualizá el impacto e intentá nuevamente.',
                            );
                          });
                      }}
                    >
                      Confirmar que {futureShifts.data.length} turnos quedan sin vigilador
                    </Button>
                  )}
                </>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
