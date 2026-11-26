import { useQuery } from '@tanstack/react-query';
import {
  checkpointArrangementInputSchema,
  checkpointInputSchema,
  checkpointsResponseSchema,
} from '@garita/shared';
import { useRef, useState, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { useFillHeight } from '@/lib/use-fill-height';
import { z } from 'zod';
import { apiDownload, apiGet, apiPatch, apiPost, ApiError } from '@/lib/api-client';
import { useBusy } from '@/lib/use-busy';
import { cn } from '@/lib/utils';
import { useAuth } from '../auth/auth-context';
import { AddressSearch } from '../mapa/address-search';
import { SiteLocation } from '../mapa/site-location';
import { SitesMap } from '../mapa/sites-map';
import { fetchStreetAddress } from '../mapa/photon';
import { DataTable, type DataColumn } from '@/components/data-table';

import { Alert } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, EllipsisVertical, Plus } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const TAG_LABEL = { qr: 'QR', nfc_basic: 'NFC común', nfc_secure: 'NFC seguro' } as const;

/** Dirección si se pudo definir la calle; si no, las coordenadas (≈1 m con 5 decimales). */
function locationLabel(point: { address?: string | null; latitude: number; longitude: number }) {
  return point.address ?? `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
}

const idResponse = z.looseObject({ id: z.string() });
const emptyInput = z.object({});

interface SiteProps {
  /** Lugar de la cabecera del predio donde van Cancelar y Guardar del modo edición. */
  actions?: HTMLElement | null;
  site: {
    id: string;
    name: string;
    latitude: number | string;
    longitude: number | string;
    status: 'active' | 'inactive';
  };
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || typeof error.body !== 'object' || error.body === null) return;
  const body = error.body as Record<string, unknown>;
  return typeof body.code === 'string' ? body.code : undefined;
}

function roundNames(error: unknown): string[] {
  if (!(error instanceof ApiError) || typeof error.body !== 'object' || error.body === null)
    return [];
  const rounds: unknown = (error.body as Record<string, unknown>).rounds;
  if (!Array.isArray(rounds)) return [];
  const names: string[] = [];
  for (const round of rounds as unknown[]) {
    if (
      typeof round === 'object' &&
      round !== null &&
      'name' in round &&
      typeof round.name === 'string'
    )
      names.push(round.name);
  }
  return names;
}

type Arrangement = { id: string; latitude: number; longitude: number }[];

/** N° editable en el modo edición: se toca, se escribe el nuevo y Enter. */
function NumberField({
  name,
  value,
  max,
  editing,
  onEdit,
  onDone,
}: {
  name: string;
  value: number;
  max: number;
  editing: boolean;
  onEdit: () => void;
  onDone: (value?: number) => void;
}) {
  // Enter o Escape desmontan el campo y disparan además onBlur: solo cuenta la primera salida.
  const settled = useRef(false);
  if (!editing)
    return (
      <button
        type="button"
        className="min-w-5 cursor-pointer rounded-sm underline decoration-dotted underline-offset-2 hover:bg-muted"
        aria-label={`Cambiar el número de ${name} (ahora ${String(value)})`}
        onClick={() => {
          // Al abrir el campo de nuevo, la salida anterior ya no cuenta (por si no llega el foco).
          settled.current = false;
          onEdit();
        }}
      >
        {value}
      </button>
    );
  const done = (value?: number) => {
    if (settled.current) return;
    settled.current = true;
    onDone(value);
  };
  return (
    <input
      type="number"
      autoFocus
      min={1}
      max={max}
      defaultValue={value}
      aria-label={`Nuevo número de ${name}`}
      className="w-10 rounded-sm border border-ring bg-card text-center tabular-nums"
      onFocus={(event) => {
        settled.current = false;
        event.target.select();
      }}
      onBlur={(event) => {
        done(event.target.valueAsNumber);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') done(event.currentTarget.valueAsNumber);
        if (event.key === 'Escape') done();
      }}
    />
  );
}

export function CheckpointsPanel({ site, actions }: SiteProps) {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const points = useQuery({
    queryKey: ['puntos', site.id],
    queryFn: () => apiGet(`/predios/${site.id}/puntos`, checkpointsResponseSchema),
  });
  const emptyForm = {
    name: '',
    latitude: Number(site.latitude),
    longitude: Number(site.longitude),
    toleranceRadiusMeters: 30,
    stickerLocation: '',
    isIndoor: false,
  };
  const [form, setForm] = useState(emptyForm);
  // Mapa y tabla llenan lo que queda de la ventana: la página no baja, se desplaza la tabla.
  const [measureFill, fillHeight] = useFillHeight<HTMLDivElement>();
  const [formOpen, setFormOpen] = useState(false);
  const { busy, run } = useBusy();
  const [editingId, setEditingId] = useState<string>();
  const [confirmFar, setConfirmFar] = useState(false);
  // Guardar el orden con algún punto movido a más de 1 km pide confirmación.
  const [farArrangement, setFarArrangement] = useState(false);
  const [pendingAction, setPendingAction] = useState<() => Promise<unknown>>();
  const [message, setMessage] = useState('');
  // Modo edición: orden y ubicación de todos los puntos, sin tocar la API hasta Guardar.
  const [draft, setDraft] = useState<Arrangement | null>(null);
  // Solo un campo a la vez: el N° se ve en la tabla y en el mapa.
  const [renumbering, setRenumbering] = useState<{ id: string; inMap: boolean } | null>(null);
  const canArrange = admin && site.status === 'active';

  const startArranging = () => {
    if (!canArrange || draft || !points.data?.length) return;
    setMessage('');
    setDraft(points.data.map(({ id, latitude, longitude }) => ({ id, latitude, longitude })));
  };
  const stopArranging = () => {
    setDraft(null);
    setRenumbering(null);
  };
  const renumber = (id: string, value?: number) => {
    setRenumbering(null);
    if (!draft || value === undefined || !Number.isInteger(value)) return;
    const moved = draft.find((point) => point.id === id);
    if (!moved) return;
    const rest = draft.filter((point) => point.id !== id);
    const index = Math.min(Math.max(value, 1), draft.length) - 1;
    setDraft([...rest.slice(0, index), moved, ...rest.slice(index)]);
  };
  const saveArrangement = () => run(() => sendArrangement(false));
  const sendArrangement = async (confirmFarLocation: boolean): Promise<void> => {
    if (!draft) return;
    // Solo los movidos buscan su dirección de nuevo; los demás conservan la guardada.
    const puntos = await Promise.all(
      draft.map(async (point) => {
        const saved = points.data?.find(({ id }) => id === point.id);
        const moved = saved?.latitude !== point.latitude || saved.longitude !== point.longitude;
        return moved
          ? { ...point, address: await fetchStreetAddress(point.latitude, point.longitude) }
          : point;
      }),
    );
    try {
      await apiPatch(
        `/predios/${site.id}/puntos/orden`,
        { puntos, confirmFarLocation },
        checkpointArrangementInputSchema,
        checkpointsResponseSchema,
      );
      stopArranging();
    } catch (error) {
      const code = errorCode(error);
      if (code === 'CHECKPOINT_LOCATION_REQUIRES_CONFIRMATION') {
        setFarArrangement(true);
        return;
      }
      if (code === 'CHECKPOINT_LIST_OUTDATED') {
        stopArranging();
        setMessage('Los puntos del predio cambiaron mientras editabas. Volvé a intentarlo.');
      } else setMessage('No se pudieron guardar los puntos. Intentá de nuevo.');
    }
    await points.refetch();
  };

  const input = (confirmFarLocation = false) => ({
    ...form,
    stickerLocation: form.stickerLocation || undefined,
    confirmFarLocation,
  });

  const save = (event?: SyntheticEvent<HTMLFormElement>, confirmed = false) => {
    event?.preventDefault();
    return run(() => saveNow(confirmed));
  };
  const saveNow = async (confirmed: boolean) => {
    const parsed = checkpointInputSchema.safeParse(input(confirmed));
    if (!parsed.success) {
      setMessage('Revisá el nombre, la ubicación y el radio de tolerancia (entre 10 y 200 m).');
      return;
    }
    // La dirección se busca al crear el punto o al moverlo (o si todavía no tenía).
    const saved = points.data?.find(({ id }) => id === editingId);
    const relocated =
      !saved?.address ||
      saved.latitude !== parsed.data.latitude ||
      saved.longitude !== parsed.data.longitude;
    const body = relocated
      ? {
          ...parsed.data,
          address: await fetchStreetAddress(parsed.data.latitude, parsed.data.longitude),
        }
      : parsed.data;
    try {
      if (editingId)
        await apiPatch(`/puntos/${editingId}`, body, checkpointInputSchema, idResponse);
      else await apiPost(`/predios/${site.id}/puntos`, body, checkpointInputSchema, idResponse);
      setConfirmFar(false);
      setEditingId(undefined);
      setForm(emptyForm);
      setFormOpen(false);
      setMessage('Punto guardado.');
      await points.refetch();
    } catch (error) {
      if (errorCode(error) === 'CHECKPOINT_LOCATION_REQUIRES_CONFIRMATION') {
        setConfirmFar(true);
        return;
      }
      setMessage('No se pudo guardar el punto. Verificá si ya existe otro con ese nombre.');
    }
  };

  const download = async (checkpointId?: string) => {
    const query = checkpointId ? `?puntos=${encodeURIComponent(checkpointId)}` : '';
    let blob: Blob;
    try {
      blob = await apiDownload(`/predios/${site.id}/stickers${query}`);
    } catch {
      setMessage('No se pudo descargar el sticker. Intentá de nuevo.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'stickers-puntos.pdf';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const edit = (point: {
    id: string;
    name: string;
    latitude: number | string;
    longitude: number | string;
    toleranceRadiusMeters: number;
    stickerLocation: string | null;
    isIndoor: boolean;
  }) => {
    setMessage('');
    setFormOpen(true);
    setEditingId(point.id);
    setForm({
      name: point.name,
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
      toleranceRadiusMeters: point.toleranceRadiusMeters,
      stickerLocation: point.stickerLocation ?? '',
      isIndoor: point.isIndoor,
    });
  };

  // En el modo edición se ve el borrador: su orden y sus ubicaciones.
  const rows = draft
    ? draft.flatMap((moved) => {
        const point = points.data?.find(({ id }) => id === moved.id);
        if (!point) return [];
        const relocated = point.latitude !== moved.latitude || point.longitude !== moved.longitude;
        // Movido en el borrador: la dirección guardada ya no corresponde hasta guardar.
        return [
          {
            ...point,
            latitude: moved.latitude,
            longitude: moved.longitude,
            address: relocated ? null : point.address,
          },
        ];
      })
    : (points.data ?? []);
  const numberOf = (id: string, index: number, name: string, inMap: boolean) =>
    draft ? (
      <NumberField
        name={name}
        value={index + 1}
        max={rows.length}
        editing={renumbering?.id === id && renumbering.inMap === inMap}
        onEdit={() => {
          setRenumbering({ id, inMap });
        }}
        onDone={(value) => {
          renumber(id, value);
        }}
      />
    ) : (
      index + 1
    );

  // Junto al título de la columna Punto: no agrandan las filas ni la cabecera del predio.
  const listActions = admin && !draft && (
    <>
      {site.status === 'active' && (
        <Button
          variant="outline"
          size="icon-xs"
          className="size-6"
          aria-label="Agregar punto"
          title="Agregar punto"
          aria-expanded={formOpen}
          aria-controls={`point-form-${site.id}`}
          onClick={() => {
            setMessage('');
            setFormOpen(true);
          }}
        >
          <Plus aria-hidden="true" />
        </Button>
      )}
      {!!points.data?.length && (
        <Button
          variant="outline"
          size="icon-xs"
          className="size-6"
          aria-label="Descargar stickers de todos"
          title="Descargar stickers de todos"
          onClick={() => void download()}
        >
          <Download aria-hidden="true" />
        </Button>
      )}
    </>
  );
  const tableRows = rows.map((point, index) => ({ ...point, number: index + 1 }));
  type Row = (typeof tableRows)[number];
  const columns: DataColumn<Row>[] = [
    {
      id: 'number',
      header: 'N°',
      type: 'number',
      width: 64,
      value: (point) => point.number,
      cell: (point) => (
        <span className="t-numeral text-muted-foreground">
          {numberOf(point.id, point.number - 1, point.name, false)}
        </span>
      ),
    },
    {
      id: 'name',
      header: 'Punto',
      headerActions: listActions,
      value: (point) => point.name,
      cell: (point) => (
        <>
          <span className="block truncate font-semibold">
            {point.name}
            {point.isIndoor ? ' · Interior' : ''}
          </span>
          <span className="block truncate text-xs text-muted-foreground tabular-nums">
            {locationLabel(point)}
          </span>
        </>
      ),
    },
    {
      id: 'type',
      header: 'Tipo',
      width: 120,
      value: (point) => TAG_LABEL[point.tagType ?? 'qr'],
    },
    {
      id: 'rounds',
      header: 'Rondas',
      type: 'number',
      align: 'right',
      width: 96,
      value: (point) => point.roundsCount,
    },
    {
      id: 'radius',
      header: 'Radio',
      type: 'number',
      align: 'right',
      width: 88,
      value: (point) => point.toleranceRadiusMeters,
      cell: (point) => `${String(point.toleranceRadiusMeters)} m`,
    },
    ...(admin
      ? [
          {
            id: 'actions',
            header: 'Acciones',
            hideHeader: true,
            width: 56,
            cell: (point: Row) => (
              // En el modo edición los demás cambios esperan: se entra por ⋮ después.
              <div className={cn('flex justify-end', draft && 'invisible')}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Más acciones de ${point.name}`}
                    >
                      <EllipsisVertical aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canArrange && (
                      <>
                        <DropdownMenuItem
                          onSelect={() => {
                            edit(point);
                          }}
                        >
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            if (
                              window.confirm(
                                'El QR impreso dejará de ser válido. ¿Querés regenerarlo?',
                              )
                            )
                              void apiPost(
                                `/puntos/${point.id}/regenerar-qr`,
                                {},
                                emptyInput,
                                z.looseObject({
                                  checkpoint: idResponse,
                                  qrPayload: z.string(),
                                }),
                              )
                                .then(async () => {
                                  await points.refetch();
                                  setMessage('QR regenerado. Imprimí un sticker nuevo.');
                                })
                                .catch(() => {
                                  setMessage('No se pudo regenerar el QR. Intentá de nuevo.');
                                });
                          }}
                        >
                          Regenerar QR
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuItem onSelect={() => void download(point.id)}>
                      Descargar sticker
                    </DropdownMenuItem>
                    {canArrange && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => {
                            setPendingAction(() => async () => {
                              try {
                                await apiPost(
                                  `/puntos/${point.id}/baja`,
                                  {},
                                  emptyInput,
                                  idResponse,
                                );
                              } catch (error) {
                                if (error instanceof ApiError && error.status === 409) {
                                  const names = roundNames(error);
                                  setMessage(
                                    names.length
                                      ? `No se puede dar de baja: está incluida en ${names.join(', ')}.`
                                      : 'No se puede dar de baja: está incluida en rondas activas.',
                                  );
                                  return;
                                }
                                setMessage('No se pudo dar de baja el punto. Intentá de nuevo.');
                              }
                            });
                          }}
                        >
                          Dar de baja
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ),
          },
        ]
      : []),
  ];

  const confirm = async () => {
    if (!pendingAction) return;
    await pendingAction();
    setPendingAction(undefined);
    await points.refetch();
  };

  return (
    <section aria-labelledby={`points-${site.id}`}>
      {/* Visible: el texto de ayuda del mapa asoma sobre la línea de la cabecera. */}
      <Card className="overflow-visible border-0 bg-transparent py-0">
        {/* La pestaña ya dice "Puntos de control": el título queda para lectores de pantalla. */}
        <h3 id={`points-${site.id}`} className="sr-only">
          Puntos de control
        </h3>
        <CardContent className="space-y-4 px-0">
          <Dialog
            open={admin && site.status === 'active' && formOpen}
            onOpenChange={(open) => {
              setFormOpen(open);
              if (open) return;
              setEditingId(undefined);
              setForm(emptyForm);
              setConfirmFar(false);
            }}
          >
            {/* Grande para ubicar el punto con precisión entre los que ya existen. */}
            <DialogContent className="w-[calc(100%-2rem)] max-w-none">
              <DialogTitle className="text-lg font-semibold">
                {editingId ? 'Editar punto' : 'Nuevo punto'}
              </DialogTitle>
              <DialogDescription>
                Buscá la dirección o ubicá el punto en el mapa arrastrando el marcador. Los números
                son los demás puntos del predio.
              </DialogDescription>
              <form
                id={`point-form-${site.id}`}
                className="mt-4 grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]"
                onSubmit={(event) => void save(event)}
              >
                {/* Mide lo mismo que el mapa: la descripción del sticker llena el hueco y, al abrir
                    la lista de puntos, le cede lugar (la lista se desplaza por dentro). */}
                <div className="flex min-w-0 flex-col gap-4 lg:h-[calc(90vh-14rem)] lg:min-h-80">
                  <Label className="grid min-w-0 gap-2">
                    Nombre del punto
                    <Input
                      required
                      maxLength={200}
                      value={form.name}
                      onChange={(event) => {
                        setForm({ ...form, name: event.target.value });
                      }}
                      className="w-full"
                    />
                  </Label>
                  <AddressSearch
                    onSelect={(latitude, longitude) => {
                      setForm({ ...form, latitude, longitude });
                    }}
                  />
                  <Label className="grid min-w-0 gap-2">
                    Radio de tolerancia (m)
                    <Input
                      aria-label="Radio de tolerancia (m)"
                      type="number"
                      min={10}
                      max={200}
                      step={1}
                      required
                      value={form.toleranceRadiusMeters}
                      onChange={(event) => {
                        setForm({ ...form, toleranceRadiusMeters: Number(event.target.value) });
                      }}
                      className="w-full"
                    />
                  </Label>
                  <Label className="flex min-h-24 min-w-0 flex-1 flex-col items-stretch gap-2">
                    Descripción de ubicación del sticker (opcional)
                    <Textarea
                      value={form.stickerLocation}
                      onChange={(event) => {
                        setForm({ ...form, stickerLocation: event.target.value });
                      }}
                      className="w-full flex-1 resize-none"
                    />
                  </Label>
                  <Label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={form.isIndoor}
                      onChange={(event) => {
                        setForm({ ...form, isIndoor: event.target.checked });
                      }}
                    />
                    Punto interior
                  </Label>
                  {confirmFar && (
                    <Alert
                      role="alertdialog"
                      aria-modal="true"
                      aria-labelledby={`far-${site.id}`}
                      className="space-y-3 border-warning bg-warning-soft text-warning"
                    >
                      <h4 id={`far-${site.id}`} className="font-semibold">
                        El punto está a más de 1 km del predio
                      </h4>
                      <p>Confirmá que la ubicación sea correcta para guardar el punto.</p>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void save(undefined, true)}
                      >
                        Confirmar ubicación
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-3"
                        onClick={() => {
                          setConfirmFar(false);
                        }}
                      >
                        Cancelar
                      </Button>
                    </Alert>
                  )}
                  {message && <p role="status">{message}</p>}
                  {!!points.data?.length && (
                    <details className="min-h-0 shrink-0 overflow-y-auto rounded-md border border-border open:shrink open:basis-0 open:grow">
                      <summary className="sticky top-0 cursor-pointer bg-popover px-3 py-2 text-sm font-semibold">
                        Puntos del predio ({points.data.length})
                      </summary>
                      {/* El número es el mismo que se ve bajo cada punto en el mapa. */}
                      <ol className="border-t border-border px-3 py-2 text-sm">
                        {points.data.map((point, index) => (
                          <li key={point.id} className="flex gap-2 py-0.5">
                            <span className="w-6 shrink-0 text-right text-muted-foreground tabular-nums">
                              {index + 1}
                            </span>
                            <span className="min-w-0 break-words">{point.name}</span>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </div>
                <SiteLocation
                  search={false}
                  others={(points.data ?? [])
                    .map((point, index) => ({ ...point, label: String(index + 1) }))
                    .filter((point) => point.id !== editingId)}
                  mapClassName="h-[calc(90vh-14rem)] min-h-80"
                  latitude={form.latitude}
                  longitude={form.longitude}
                  onChange={(latitude, longitude) => {
                    setForm({ ...form, latitude, longitude });
                  }}
                />
                <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4 lg:col-span-2">
                  <DialogClose asChild>
                    <Button type="button" variant="outline">
                      Cancelar
                    </Button>
                  </DialogClose>
                  <Button type="submit" disabled={busy}>
                    {editingId ? 'Guardar cambios' : 'Crear punto'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
          {!formOpen && message && <p role="status">{message}</p>}
          {points.isPending ? (
            <p role="status">Cargando puntos…</p>
          ) : points.isError ? (
            <Alert variant="destructive">No se pudieron cargar los puntos.</Alert>
          ) : (
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              {rows.length > 0 && (
                <div
                  aria-label={`Mapa de puntos de ${site.name}`}
                  className="relative xl:sticky xl:top-4 xl:order-last"
                >
                  {canArrange && (
                    // Apoyado en la línea de la cabecera, justo arriba del mapa.
                    <p className="absolute bottom-full left-0 mb-1 text-xs text-muted-foreground">
                      {draft ? (
                        'Arrastrá los pines o tocá un número para cambiarlo.'
                      ) : (
                        // También es un botón: con teclado no se puede mantener un pin.
                        <button
                          type="button"
                          className="cursor-pointer hover:text-foreground"
                          onClick={startArranging}
                        >
                          Mantené un pin para editar
                        </button>
                      )}
                    </p>
                  )}
                  <SitesMap
                    sites={rows.map((point, index) => ({
                      ...point,
                      label: numberOf(point.id, index, point.name, true),
                      draggable: !!draft,
                    }))}
                    height={fillHeight}
                    onHold={canArrange ? startArranging : undefined}
                    onMove={(id, latitude, longitude) => {
                      setDraft(
                        (current) =>
                          current?.map((point) =>
                            point.id === id ? { id, latitude, longitude } : point,
                          ) ?? null,
                      );
                    }}
                  />
                </div>
              )}
              {draft &&
                actions &&
                createPortal(
                  <>
                    <Button variant="ghost" size="xs" disabled={busy} onClick={stopArranging}>
                      Cancelar
                    </Button>
                    <Button size="xs" disabled={busy} onClick={() => void saveArrangement()}>
                      Guardar
                    </Button>
                  </>,
                  actions,
                )}
              {/* En pantallas anchas la tabla se desplaza sola y ocupa el mismo alto que el mapa. */}
              <div ref={measureFill} style={{ maxHeight: fillHeight }} className="overflow-y-auto">
                <DataTable
                  label={`Puntos de control de ${site.name}`}
                  rows={tableRows}
                  getRowId={(point) => point.id}
                  columns={columns}
                />
              </div>
            </div>
          )}
          <AlertDialog open={farArrangement} onOpenChange={setFarArrangement}>
            <AlertDialogContent className="space-y-4">
              <AlertDialogTitle className="text-lg font-semibold">
                Algún punto quedó a más de 1 km del predio
              </AlertDialogTitle>
              <AlertDialogDescription>
                Confirmá que las ubicaciones sean correctas para guardar los puntos.
              </AlertDialogDescription>
              <div className="flex flex-wrap justify-end gap-2">
                <AlertDialogCancel asChild>
                  <Button variant="outline">Cancelar</Button>
                </AlertDialogCancel>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setFarArrangement(false);
                    void run(() => sendArrangement(true));
                  }}
                >
                  Guardar igual
                </Button>
              </div>
            </AlertDialogContent>
          </AlertDialog>
          {/* Diálogo y no un aviso al pie: debajo de la tabla quedaba fuera de la pantalla. */}
          <AlertDialog
            open={!!pendingAction}
            onOpenChange={(open) => {
              if (!open) setPendingAction(undefined);
            }}
          >
            <AlertDialogContent className="space-y-4">
              <AlertDialogTitle className="text-lg font-semibold">Confirmar baja</AlertDialogTitle>
              <AlertDialogDescription>¿Dar de baja este punto de control?</AlertDialogDescription>
              <div className="flex flex-wrap justify-end gap-2">
                <AlertDialogCancel asChild>
                  <Button variant="outline">Cancelar</Button>
                </AlertDialogCancel>
                <Button onClick={() => void confirm()} variant="destructive">
                  Confirmar baja
                </Button>
              </div>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </section>
  );
}
