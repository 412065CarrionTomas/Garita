import { useQuery } from '@tanstack/react-query';
import { checkpointInputSchema, checkpointsResponseSchema } from '@garita/shared';
import { useState, type SyntheticEvent } from 'react';
import { z } from 'zod';
import { apiDownload, apiGet, apiPatch, apiPost, ApiError } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';
import { SiteLocation } from '../mapa/site-location';
import { SitesMap } from '../mapa/sites-map';

import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const idResponse = z.looseObject({ id: z.string() });
const emptyInput = z.object({});

interface SiteProps {
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

export function CheckpointsPanel({ site }: SiteProps) {
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
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [confirmFar, setConfirmFar] = useState(false);
  const [pendingAction, setPendingAction] = useState<() => Promise<unknown>>();
  const [message, setMessage] = useState('');

  const input = (confirmFarLocation = false) => ({
    ...form,
    stickerLocation: form.stickerLocation || undefined,
    confirmFarLocation,
  });

  const save = async (event?: SyntheticEvent<HTMLFormElement>, confirmed = false) => {
    event?.preventDefault();
    const parsed = checkpointInputSchema.safeParse(input(confirmed));
    if (!parsed.success) {
      setMessage('Revisá el nombre, la ubicación y el radio de tolerancia (entre 10 y 200 m).');
      return;
    }
    try {
      if (editingId)
        await apiPatch(`/puntos/${editingId}`, parsed.data, checkpointInputSchema, idResponse);
      else
        await apiPost(`/predios/${site.id}/puntos`, parsed.data, checkpointInputSchema, idResponse);
      setConfirmFar(false);
      setEditingId(undefined);
      setForm(emptyForm);
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

  const confirm = async () => {
    if (!pendingAction) return;
    await pendingAction();
    setPendingAction(undefined);
    await points.refetch();
  };

  return (
    <section aria-labelledby={`points-${site.id}`} className="mt-4">
      <Card className="border-0 py-0">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h3
            id={`points-${site.id}`}
            className="font-cond text-xl font-semibold uppercase tracking-wider"
          >
            Puntos de control
          </h3>
          {admin && site.status === 'active' && (
            <Button
              variant="outline"
              onClick={() => {
                setFormOpen(!formOpen);
              }}
              aria-expanded={formOpen}
              aria-controls={`point-form-${site.id}`}
            >
              Agregar punto
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {admin && site.status === 'active' && formOpen && (
            <form
              id={`point-form-${site.id}`}
              className="grid gap-4"
              onSubmit={(event) => void save(event)}
            >
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
              <SiteLocation
                latitude={form.latitude}
                longitude={form.longitude}
                onChange={(latitude, longitude) => {
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
              <Label className="grid min-w-0 gap-2">
                Ubicación del sticker (opcional)
                <Textarea
                  value={form.stickerLocation}
                  onChange={(event) => {
                    setForm({ ...form, stickerLocation: event.target.value });
                  }}
                  className="w-full"
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
              <div className="flex gap-3">
                <Button type="submit">{editingId ? 'Guardar cambios' : 'Crear punto'}</Button>
                {editingId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingId(undefined);
                      setForm(emptyForm);
                      setConfirmFar(false);
                    }}
                  >
                    Cancelar edición
                  </Button>
                )}
              </div>
            </form>
          )}
          {admin && !!points.data?.length && (
            <Button variant="outline" onClick={() => void download()}>
              Descargar stickers de todos
            </Button>
          )}
          {message && <p role="status">{message}</p>}
          {points.isPending ? (
            <p role="status">Cargando puntos…</p>
          ) : points.isError ? (
            <Alert variant="destructive">No se pudieron cargar los puntos.</Alert>
          ) : (
            <>
              {points.data.length > 0 && (
                <div aria-label={`Mapa de puntos de ${site.name}`}>
                  <SitesMap sites={[site, ...points.data]} />
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col" className="t-label w-12">
                      N°
                    </TableHead>
                    <TableHead scope="col" className="t-label">
                      Punto
                    </TableHead>
                    <TableHead scope="col" className="t-label">
                      Estado
                    </TableHead>
                    <TableHead scope="col" className="t-label">
                      Ubicación
                    </TableHead>
                    {admin && (
                      <TableHead scope="col" className="t-label">
                        Acciones
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {points.data.map((point, index) => (
                    <TableRow key={point.id}>
                      <TableCell className="t-numeral text-muted-foreground">{index + 1}</TableCell>
                      <TableCell className="font-semibold">
                        {point.name}
                        {point.isIndoor ? ' · Interior' : ''}
                        {point.stickerLocation && (
                          <p className="text-sm font-normal text-muted-foreground">
                            {point.stickerLocation}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        {/* TODO(foja): la maqueta muestra Instalada / Falta imprimir; la API aún no expone si el QR se imprimió. */}
                        <StatusBadge tone={point.status === 'active' ? 'success' : 'neutral'}>
                          {point.status === 'active' ? 'Activo' : 'Inactivo'}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        Radio: {point.toleranceRadiusMeters} m · {point.latitude}, {point.longitude}
                      </TableCell>
                      {admin && (
                        <TableCell>
                          <div className="flex flex-wrap gap-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                edit(point);
                              }}
                            >
                              Editar
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
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
                            </Button>
                            <Button
                              variant="ghostDestructive"
                              size="sm"
                              onClick={() => {
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
                                    setMessage(
                                      'No se pudo dar de baja el punto. Intentá de nuevo.',
                                    );
                                  }
                                });
                              }}
                            >
                              Dar de baja
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void download(point.id)}
                            >
                              Descargar sticker
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
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
              <Button variant="outline" onClick={() => void save(undefined, true)}>
                Confirmar ubicación
              </Button>
              <Button
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
          {pendingAction && (
            <Alert
              role="alertdialog"
              aria-modal="true"
              aria-label="Confirmar baja"
              className="space-y-3 border-warning bg-warning-soft text-warning"
            >
              <p>¿Dar de baja este punto de control?</p>
              <Button onClick={() => void confirm()} variant="destructive">
                Confirmar baja
              </Button>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => {
                  setPendingAction(undefined);
                }}
              >
                Cancelar
              </Button>
            </Alert>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
